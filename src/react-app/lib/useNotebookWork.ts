/**
 * Shared state for working inside a notebook instance: layer maps, undo history,
 * field values, and the autosave queue that keeps them on the server.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type WorkResponse } from "./api";
import { useAutosave } from "./autosave";
import { type LayerData, emptyLayer, serializeLayer, serializeDelta } from "./ink";
import { buildLayerMaps, type LayerMap } from "../components/NotebookSurface";

const HISTORY_LIMIT = 40;

interface Options {
  notebookId: string;
  studentId?: string;
  /** Which layer this session writes to. `null` is read-only. */
  writeTarget: "student" | "teacher" | null;
  data?: WorkResponse;
}

export function useNotebookWork({ notebookId, studentId, writeTarget, data }: Options) {
  const [studentLayers, setStudentLayers] = useState<LayerMap>({});
  const [teacherLayers, setTeacherLayers] = useState<LayerMap>({});
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const revs = useRef<Record<string, number>>({});
  /**
   * The strokes the server is known to hold, per layer, as the very objects
   * that are in state. Identity is what tells an append apart from an erase.
   */
  const syncedStrokes = useRef<Record<string, LayerData["s"]>>({});
  const dirtyLayers = useRef<Set<string>>(new Set());
  const dirtyValues = useRef<Set<string>>(new Set());

  // Undo/redo, scoped to the page currently being edited.
  const history = useRef<Record<string, { past: LayerData[]; future: LayerData[] }>>({});
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    if (!data) return;
    const maps = buildLayerMaps(data.layers);
    setStudentLayers(maps.student);
    setTeacherLayers(maps.teacher);
    revs.current = maps.revs;
    // Everything just loaded is by definition what the server holds, so the
    // first stroke drawn after opening a page can already go up as a delta.
    syncedStrokes.current = {};
    for (const [pageId, layer] of Object.entries(maps.student)) {
      syncedStrokes.current[`student:${pageId}`] = layer.s.slice();
    }
    for (const [pageId, layer] of Object.entries(maps.teacher)) {
      syncedStrokes.current[`teacher:${pageId}`] = layer.s.slice();
    }
    const values: Record<string, string> = {};
    for (const v of data.values) values[v.field_id] = v.value;
    setFieldValues(values);
    history.current = {};
    dirtyLayers.current.clear();
    dirtyValues.current.clear();
  }, [data]);

  const saveKey = `notesanity:work:${notebookId}:${studentId ?? "me"}:${writeTarget ?? "ro"}`;

  const layersRef = useRef({ studentLayers, teacherLayers, fieldValues });
  layersRef.current = { studentLayers, teacherLayers, fieldValues };

  const { status, queue, flush } = useAutosave<number>({
    key: saveKey,
    enabled: writeTarget !== null,
    save: async () => {
      const target = writeTarget;
      if (!target) return;
      const map = target === "teacher" ? layersRef.current.teacherLayers : layersRef.current.studentLayers;
      const pageIds = Array.from(dirtyLayers.current);
      const query = studentId ? `?student=${encodeURIComponent(studentId)}` : "";

      for (const pageId of pageIds) {
        const layer = map[pageId] ?? emptyLayer();
        const revKey = `${target}:${pageId}`;
        const url = `/api/notebooks/${notebookId}/layers/${pageId}${query}`;
        const rev = revs.current[revKey] ?? 0;
        const synced = syncedStrokes.current[revKey];

        // A pure append leaves every already-saved stroke untouched, so the
        // strokes we sent last time are still the same objects in the same
        // order. Erasing or undoing rebuilds the array and fails this check,
        // which is exactly when the whole layer has to go.
        const appended =
          synced !== undefined &&
          layer.s.length >= synced.length &&
          synced.every((st, i) => st === layer.s[i]);

        let res: { rev: number };
        if (appended) {
          try {
            res = await api.put<{ rev: number }>(url, {
              kind: target,
              rev,
              delta: serializeDelta(layer, synced!.length),
            });
          } catch {
            // The server refused the base revision — someone saved from
            // another device. Send the whole layer, which is the same thing
            // this code did before deltas existed.
            res = await api.put<{ rev: number }>(url, { kind: target, data: serializeLayer(layer), rev });
          }
        } else {
          res = await api.put<{ rev: number }>(url, { kind: target, data: serializeLayer(layer), rev });
        }

        revs.current[revKey] = res.rev;
        // Remember the exact stroke objects the server now holds.
        syncedStrokes.current[revKey] = layer.s.slice();
        dirtyLayers.current.delete(pageId);
      }

      if (dirtyValues.current.size > 0 && target === "student") {
        const ids = Array.from(dirtyValues.current);
        await api.put(`/api/notebooks/${notebookId}/values${query}`, {
          values: ids.map((fieldId) => ({ fieldId, value: layersRef.current.fieldValues[fieldId] ?? "" })),
        });
        dirtyValues.current.clear();
      }
    },
  });

  const setLayer = useCallback(
    (pageId: string, next: LayerData, recordHistory = true) => {
      const target = writeTarget;
      if (!target) return;
      const setter = target === "teacher" ? setTeacherLayers : setStudentLayers;
      setter((prev) => {
        if (recordHistory) {
          const entry = (history.current[pageId] ??= { past: [], future: [] });
          entry.past.push(prev[pageId] ?? emptyLayer());
          if (entry.past.length > HISTORY_LIMIT) entry.past.shift();
          entry.future = [];
        }
        return { ...prev, [pageId]: next };
      });
      dirtyLayers.current.add(pageId);
      queue(Date.now());
      if (recordHistory) setHistoryTick((t) => t + 1);
    },
    [writeTarget, queue],
  );

  const undo = useCallback((pageId: string) => {
    const target = writeTarget;
    if (!target) return;
    const entry = history.current[pageId];
    if (!entry?.past.length) return;
    const setter = target === "teacher" ? setTeacherLayers : setStudentLayers;
    setter((prev) => {
      const previous = entry.past.pop()!;
      entry.future.push(prev[pageId] ?? emptyLayer());
      return { ...prev, [pageId]: previous };
    });
    dirtyLayers.current.add(pageId);
    queue(Date.now());
    setHistoryTick((t) => t + 1);
  }, [writeTarget, queue]);

  const redo = useCallback((pageId: string) => {
    const target = writeTarget;
    if (!target) return;
    const entry = history.current[pageId];
    if (!entry?.future.length) return;
    const setter = target === "teacher" ? setTeacherLayers : setStudentLayers;
    setter((prev) => {
      const next = entry.future.pop()!;
      entry.past.push(prev[pageId] ?? emptyLayer());
      return { ...prev, [pageId]: next };
    });
    dirtyLayers.current.add(pageId);
    queue(Date.now());
    setHistoryTick((t) => t + 1);
  }, [writeTarget, queue]);

  const setFieldValue = useCallback((fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    dirtyValues.current.add(fieldId);
    queue(Date.now());
  }, [queue]);

  const canUndo = useCallback((pageId: string) => (history.current[pageId]?.past.length ?? 0) > 0, []);
  const canRedo = useCallback((pageId: string) => (history.current[pageId]?.future.length ?? 0) > 0, []);

  return useMemo(
    () => ({
      studentLayers, teacherLayers, fieldValues,
      setLayer, setFieldValue, undo, redo, canUndo, canRedo,
      status, flush, historyTick,
    }),
    [studentLayers, teacherLayers, fieldValues, setLayer, setFieldValue, undo, redo, canUndo, canRedo, status, flush, historyTick],
  );
}
