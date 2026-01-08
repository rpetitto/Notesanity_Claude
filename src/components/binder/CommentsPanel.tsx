import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Send, Check, MoreVertical, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { base44 } from '@/lib/base44-sdk'
import type { CommentThread, Comment, User } from '@/types'
import { cn } from '@/lib/utils'

// Mock comments data
const MOCK_THREADS: (CommentThread & { comments: Comment[] })[] = [
  {
    id: 't1',
    pageId: 'p1',
    status: 'open',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    comments: [
      {
        id: 'c1',
        threadId: 't1',
        authorUserId: 'u1',
        authorName: 'Ms. Smith',
        body: 'Great work on this section! Can you expand on the third point?',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      },
      {
        id: 'c2',
        threadId: 't1',
        authorUserId: 'u2',
        authorName: 'Alice Johnson',
        body: 'Thank you! I will add more details.',
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T10:30:00Z',
      },
    ],
  },
]

interface CommentsPanelProps {
  pageId: string
  onClose: () => void
}

export default function CommentsPanel({ pageId, onClose }: CommentsPanelProps) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [newComment, setNewComment] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)

  // Fetch user on mount
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me()
        setUser(userData)
      } catch (err) {
        console.error('Failed to fetch user:', err)
      }
    }
    fetchUser()
  }, [])

  // Fetch comment threads
  const { data: threads = MOCK_THREADS, isLoading } = useQuery({
    queryKey: ['comments', pageId],
    queryFn: async () => {
      // In real implementation, fetch from base44.entities.CommentThread.list()
      return MOCK_THREADS.filter(t => t.pageId === pageId)
    },
    enabled: !!pageId,
  })

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async ({ threadId, body }: { threadId?: string; body: string }) => {
      if (threadId) {
        // Add reply to existing thread
        await base44.entities.Comment.create({
          threadId,
          authorUserId: user?.id,
          authorName: user?.full_name,
          body,
        })
      } else {
        // Create new thread with comment
        const thread = await base44.entities.CommentThread.create({
          pageId,
          status: 'open',
        })
        await base44.entities.Comment.create({
          threadId: thread.id,
          authorUserId: user?.id,
          authorName: user?.full_name,
          body,
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', pageId] })
      setNewComment('')
      setReplyingTo(null)
      toast.success('Comment added')
    },
    onError: () => {
      toast.error('Failed to add comment')
    },
  })

  // Resolve thread mutation
  const resolveThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      await base44.entities.CommentThread.update(threadId, { status: 'resolved' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', pageId] })
      toast.success('Thread resolved')
    },
    onError: () => {
      toast.error('Failed to resolve thread')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim()) return
    addCommentMutation.mutate({ threadId: replyingTo || undefined, body: newComment.trim() })
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header - Material v3 style */}
      <header className="h-14 border-b border-outline-variant flex items-center px-4 gap-3 bg-surface-container-low">
        <h3 className="font-medium text-title-medium text-on-surface">Comments</h3>
        <span className="text-body-medium text-on-surface-variant">
          ({threads.filter(t => t.status === 'open').length} open)
        </span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="btn-icon"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Comment Threads */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-on-surface-variant">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-4" />
              <p className="text-body-medium">Loading comments...</p>
            </div>
          </div>
        ) : threads.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-on-surface-variant">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-surface-container-highest flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="h-8 w-8 opacity-40" />
              </div>
              <p className="text-title-medium mb-1">No comments yet</p>
              <p className="text-body-medium">Start a conversation below</p>
            </div>
          </div>
        ) : (
          threads.map((thread) => (
            <div
              key={thread.id}
              className={cn(
                "border-b border-outline-variant",
                thread.status === 'resolved' && "opacity-60"
              )}
            >
              {/* Thread Header - Material v3 chips */}
              <div className="flex items-center justify-between px-4 py-3 bg-surface-container-low">
                <span className={cn(
                  "text-label-small px-3 py-1 rounded-small",
                  thread.status === 'open'
                    ? "bg-primary-container text-on-primary-container"
                    : "bg-tertiary-container text-on-tertiary-container"
                )}>
                  {thread.status === 'open' ? 'Open' : 'Resolved'}
                </span>
                <div className="relative">
                  <button
                    onClick={() => setActiveMenu(activeMenu === thread.id ? null : thread.id)}
                    className="btn-icon"
                  >
                    <MoreVertical className="h-5 w-5" />
                  </button>
                  {activeMenu === thread.id && (
                    <div className="absolute right-0 top-full mt-1 w-40 bg-surface-container rounded-medium shadow-elevation-2 z-50 border border-outline-variant overflow-hidden">
                      <div className="py-1">
                        {thread.status === 'open' && (
                          <button
                            onClick={() => {
                              resolveThreadMutation.mutate(thread.id)
                              setActiveMenu(null)
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-body-medium text-on-surface hover:bg-surface-variant transition-colors"
                          >
                            <Check className="h-5 w-5 text-on-surface-variant" />
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Comments */}
              {thread.comments.map((comment) => (
                <div key={comment.id} className="px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-primary-container rounded-full flex items-center justify-center text-on-primary-container text-label-large font-medium flex-shrink-0">
                      {comment.authorName?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-body-large text-on-surface">{comment.authorName || 'Unknown'}</span>
                        <span className="text-body-small text-on-surface-variant">
                          {formatTime(comment.created_at)}
                        </span>
                      </div>
                      <p className="text-body-medium text-on-surface mt-1">{comment.body}</p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Reply Button */}
              {thread.status === 'open' && (
                <div className="px-4 pb-4">
                  <button
                    onClick={() => setReplyingTo(thread.id)}
                    className="text-label-large text-primary hover:text-primary/80 transition-colors"
                  >
                    Reply
                  </button>
                </div>
              )}

              {/* Reply Form */}
              {replyingTo === thread.id && (
                <div className="px-4 pb-4">
                  <form onSubmit={handleSubmit} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Write a reply..."
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      className="flex-1 px-4 py-3 text-body-large bg-surface-container-highest rounded-full
                                 focus:outline-none focus:ring-2 focus:ring-primary border-0
                                 placeholder:text-on-surface-variant"
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={!newComment.trim() || addCommentMutation.isPending}
                      className="btn-icon-filled disabled:opacity-38"
                    >
                      <Send className="h-5 w-5" />
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* New Comment Form - Material v3 text field */}
      {!replyingTo && (
        <div className="border-t border-outline-variant p-4 bg-surface-container-low">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="Start a new thread..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className="flex-1 px-4 py-3 text-body-large bg-surface-container-highest rounded-full
                         focus:outline-none focus:ring-2 focus:ring-primary border-0
                         placeholder:text-on-surface-variant"
            />
            <button
              type="submit"
              disabled={!newComment.trim() || addCommentMutation.isPending}
              className="btn-icon-filled disabled:opacity-38"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
