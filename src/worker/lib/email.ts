/**
 * The house style for anything Notesanity emails out.
 *
 * Email is not the web, and most of the brand's toolkit isn't available:
 *
 *  - Web fonts don't load in Gmail or Outlook, so Space Grotesk and Nunito are
 *    *named* (they'll be used where installed, e.g. Apple Mail) but the stack
 *    falls back to system faces everywhere else. No @font-face, no pretending.
 *  - Outlook renders through Word: no flexbox, no grid, and no border-radius.
 *    Layout is therefore tables, and the pill button degrades to a rectangle
 *    there — still Mint on Pine, still legible, just square.
 *  - `box-shadow` is used for the brand's hard offset rather than the usual
 *    nested-table trick: clients that support it get it, the rest simply lose
 *    the shadow instead of risking a broken layout.
 *  - The mark is drawn with a bordered cell and a tick character, not an image.
 *    Images are blocked by default in most clients, and a logo that usually
 *    doesn't appear is worse than no logo.
 *
 * Every message also carries a plain-text alternative built from the same
 * inputs, so the two can't drift — and a mail with no text part looks like bulk
 * mail to spam filters, which is half of why a bare HTML message "feels spammy".
 */

const PINE = "#20302C";
const MINT = "#7FD1AE";
const OAT = "#F4EFE6";
const QUIET = "#5b6b66";

const DISPLAY = "'Space Grotesk','Trebuchet MS','Segoe UI',Helvetica,Arial,sans-serif";
const BODY = "Nunito,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface EmailContent {
  /** The inbox preview line. Without one, clients show raw markup or nothing. */
  preheader: string;
  heading: string;
  /** Body paragraphs, plain text — they are escaped, not parsed as markup. */
  body: string[];
  action?: { label: string; url: string };
  /** Quieter closing line, e.g. what to do if this wasn't you. */
  note?: string;
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const { preheader, heading, body, action, note } = content;

  const paragraphs = body
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-family:${BODY};font-size:17px;line-height:1.5;color:${PINE}">${esc(p)}</p>`,
    )
    .join("");

  const button = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px">
         <tr><td style="border-radius:999px;background:${MINT};border:3px solid ${PINE};box-shadow:4px 4px 0 0 ${PINE}">
           <a href="${esc(action.url)}"
              style="display:inline-block;padding:13px 26px;font-family:${DISPLAY};font-size:17px;font-weight:700;
                     color:${PINE};text-decoration:none;border-radius:999px">${esc(action.label)}</a>
         </td></tr>
       </table>
       <p style="margin:14px 0 0;font-family:${BODY};font-size:14px;line-height:1.5;color:${QUIET}">
         If the button doesn't work, copy this address into your browser:<br>
         <span style="color:${QUIET};word-break:break-all">${esc(action.url)}</span>
       </p>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${OAT};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">
  ${esc(preheader)}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;
</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${OAT}">
  <tr><td align="center" style="padding:28px 16px">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">
      <tr><td style="padding:0 4px 16px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="width:34px;height:34px;background:${MINT};border:3px solid ${PINE};border-radius:10px;
                     text-align:center;vertical-align:middle;font-family:${DISPLAY};font-size:19px;
                     font-weight:700;color:${PINE};line-height:34px">&#10003;</td>
          <td style="padding-left:10px;font-family:${DISPLAY};font-size:23px;font-weight:700;color:${PINE}">Notesanity</td>
        </tr></table>
      </td></tr>

      <tr><td style="background:#ffffff;border:3px solid ${PINE};border-radius:22px;
                     box-shadow:4px 4px 0 0 ${PINE};padding:26px">
        <h1 style="margin:0 0 14px;font-family:${DISPLAY};font-size:24px;line-height:1.25;font-weight:700;color:${PINE}">${esc(heading)}</h1>
        ${paragraphs}
        ${button}
      </td></tr>

      ${note
        ? `<tr><td style="padding:18px 8px 0;font-family:${BODY};font-size:14px;line-height:1.5;color:${QUIET}">${esc(note)}</td></tr>`
        : ""}

      <tr><td style="padding:18px 8px 0;font-family:${BODY};font-size:13px;line-height:1.5;color:${QUIET}">
        Notesanity &middot; sent because someone asked for it at your address.
      </td></tr>
    </table>

  </td></tr>
</table>
</body></html>`;

  const text = [
    "NOTESANITY",
    "",
    heading,
    "",
    ...body,
    ...(action ? ["", `${action.label}: ${action.url}`] : []),
    ...(note ? ["", note] : []),
  ].join("\n");

  return { html, text };
}
