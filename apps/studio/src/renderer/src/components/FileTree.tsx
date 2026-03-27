/**
 * FileTree — IDE-style file explorer panel for a single pane.
 *
 * Displays the pane's project root directory as a collapsible tree.
 * Clicking a file opens it in the FileViewer via the pane store.
 * Supports right-click context menu for copying paths.
 */

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  type MouseEvent,
} from 'react'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileJson,
  FileImage,
  BookOpen,
  FileText,
  RefreshCw,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { getFileTreeStore } from '../store/file-tree-store'
import { getPaneStore } from '../store/pane-store'
import { getBridge } from '../lib/bridge'
import type { GitChangeStatus } from '../../../preload'

// ============================================================================
// Props
// ============================================================================

interface FileTreeProps {
  paneId: string
  /** Called when a file is opened — lets App.tsx show the FileViewer panel. */
  onFileOpen?: () => void
  onClose?: () => void
  embedded?: boolean
}

// ============================================================================
// Helpers — file icon by extension
// ============================================================================

function getFileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return FileCode
    case '.json':
    case '.jsonc':
      return FileJson
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.svg':
    case '.webp':
    case '.ico':
      return FileImage
    case '.md':
    case '.mdx':
      return BookOpen
    default:
      return FileText
  }
}

function getStatusBadgeClass(status: GitChangeStatus): string {
  switch (status) {
    case 'A':
    case '??':
      return 'bg-emerald-400'
    case 'D':
      return 'bg-red-400'
    case 'R':
      return 'bg-sky-400'
    case 'U':
      return 'bg-amber-300'
    default:
      return 'bg-amber-400'
  }
}

// ============================================================================
// Context menu
// ============================================================================

interface ContextMenuState {
  x: number
  y: number
  relativePath: string
  isDir: boolean
}

// ============================================================================
// FileTreeNode — recursive tree row
// ============================================================================

interface FileTreeNodeProps {
  paneId: string
  /** Parent directory's relative path ('' = root). */
  parentPath: string
  depth: number
  onFileOpen?: () => void
  onContextMenu: (e: MouseEvent, relativePath: string, isDir: boolean) => void
}

function FileTreeNode({
  paneId,
  parentPath,
  depth,
  onFileOpen,
  onContextMenu,
}: FileTreeNodeProps) {
  const treeStore = getFileTreeStore(paneId)
  const paneStore = getPaneStore(paneId)

  const { dirContents, expandedDirs, changedFilesMap, loading, toggleDir } = treeStore()
  const { activeFilePath, projectRoot } = paneStore()

  const entries = dirContents.get(parentPath)

  if (!entries) return null

  return (
    <>
      {entries.map((entry) => {
        const childPath = parentPath ? `${parentPath}/${entry.name}` : entry.name
        const isDir = entry.type === 'directory'
        const isExpanded = expandedDirs.has(childPath)
        const isLoading = loading.has(childPath)
        const changedFile = changedFilesMap.get(childPath)
        const isModified = Boolean(changedFile)
        const isActive = !isDir && childPath === activeFilePath

        const indentPx = 16 * depth

        if (isDir) {
          const DirIcon = isExpanded ? FolderOpen : Folder
          const ChevronIcon = isExpanded ? ChevronDown : ChevronRight

          return (
            <div key={childPath}>
              <div
                role="treeitem"
                aria-expanded={isExpanded}
                className={[
                  'flex items-center gap-1 py-[3px] cursor-pointer select-none',
                  'hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors',
                  'h-7 text-[13px]',
                ].join(' ')}
                style={{ paddingLeft: `${indentPx + 4}px`, paddingRight: '8px' }}
                onClick={() => {
                  treeStore.getState().toggleDir(childPath).catch((err: unknown) => {
                    toast.error(err instanceof Error ? err.message : 'Failed to list directory')
                  })
                }}
                onContextMenu={(e) => onContextMenu(e, childPath, true)}
              >
                <ChevronIcon className="size-3 flex-shrink-0 text-text-tertiary" />
                <DirIcon className="size-3.5 flex-shrink-0 text-text-tertiary" />
                <span className="truncate flex-1">{entry.name}</span>
              </div>

              {/* Loading row */}
              {isLoading && !dirContents.has(childPath) && (
                <div
                  className="flex items-center gap-1 h-7 text-[12px] text-text-tertiary animate-pulse"
                  style={{ paddingLeft: `${indentPx + 28}px` }}
                >
                  Loading...
                </div>
              )}

              {/* Recurse into expanded dir */}
              {isExpanded && !isLoading && (
                <FileTreeNode
                  paneId={paneId}
                  parentPath={childPath}
                  depth={depth + 1}
                  onFileOpen={onFileOpen}
                  onContextMenu={onContextMenu}
                />
              )}
            </div>
          )
        }

        // File row
        const FileIcon = getFileIcon(entry.name)

        return (
          <div
            key={childPath}
            role="treeitem"
            className={[
              'flex items-center gap-1 py-[3px] cursor-pointer select-none',
              'hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors',
              'h-7 text-[13px]',
              isActive ? 'bg-bg-hover text-text-primary' : '',
            ].join(' ')}
            style={{ paddingLeft: `${indentPx + 4}px`, paddingRight: '8px' }}
            onClick={() => {
              getBridge().fsReadFile(paneId, childPath)
                .then((result) => {
                  getPaneStore(paneId).getState().openFile({
                    relativePath: childPath,
                    content: result.content,
                    source: 'user',
                    truncated: result.truncated,
                    isBinary: result.isBinary,
                  })
                  onFileOpen?.()
                })
                .catch((err: unknown) => {
                  toast.error(err instanceof Error ? err.message : 'Failed to read file')
                })
            }}
            onContextMenu={(e) => onContextMenu(e, childPath, false)}
            title={projectRoot ? `${projectRoot}/${childPath}` : childPath}
          >
            <FileIcon className="size-3.5 flex-shrink-0 text-text-tertiary" />
            <span className="truncate flex-1">{entry.name}</span>
            {isModified && (
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusBadgeClass(changedFile!.status)}`}
                title={`Changed (${changedFile!.status})`}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

// ============================================================================
// FileTree
// ============================================================================

export function FileTree({ paneId, onFileOpen, onClose, embedded = false }: FileTreeProps) {
  const treeStore = getFileTreeStore(paneId)
  const paneStore = getPaneStore(paneId)

  const { loading } = treeStore()
  const rootLoading = loading.has('')
  const hasRootEntries = treeStore((s) => s.dirContents.has(''))

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // -------------------------------------------------------------------------
  // Mount: fetch root directory, modified files, and pane info
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Fetch root directory contents
    treeStore.getState().refreshDir('').catch(() => {})

    // Fetch modified files (git status)
    treeStore.getState().refreshModifiedFiles().catch(() => {})

    // Fetch pane info to get project root
    getBridge().getPaneInfo(paneId)
      .then((info) => {
        paneStore.getState().setProjectRoot(info.projectRoot)
      })
      .catch(() => {})
  }, [paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Context menu dismiss on outside click
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick, { once: true })
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu])

  // -------------------------------------------------------------------------
  // Context menu handler
  // -------------------------------------------------------------------------

  const handleContextMenu = useCallback(
    (e: MouseEvent, relativePath: string, isDir: boolean) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY, relativePath, isDir })
    },
    [],
  )

  const handleCopyPath = useCallback(() => {
    if (!contextMenu) return
    const projectRoot = paneStore.getState().projectRoot
    const full = projectRoot ? `${projectRoot}/${contextMenu.relativePath}` : contextMenu.relativePath
    navigator.clipboard.writeText(full).catch(() => {})
    setContextMenu(null)
  }, [contextMenu, paneStore])

  const handleCopyRelativePath = useCallback(() => {
    if (!contextMenu) return
    navigator.clipboard.writeText(contextMenu.relativePath).catch(() => {})
    setContextMenu(null)
  }, [contextMenu])

  // -------------------------------------------------------------------------
  // Refresh button handler
  // -------------------------------------------------------------------------

  const handleRefresh = useCallback(() => {
    treeStore.getState().refreshDir('').catch(() => {
      toast.error('Failed to refresh directory')
    })
    treeStore.getState().refreshModifiedFiles().catch(() => {})
  }, [treeStore])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full min-w-[220px] flex-col overflow-hidden bg-bg-secondary">
      {!embedded && (
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-border/40">
          <span className="text-[10px] text-text-tertiary font-semibold tracking-wider uppercase">
            Explorer
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRefresh}
              className="p-0.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`size-3 ${rootLoading ? 'animate-spin' : ''}`} />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-0.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
                title="Close explorer"
                aria-label="Close explorer"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {embedded && (
        <div className="flex-shrink-0 flex items-center justify-end px-2 py-1.5 border-b border-border/40">
          <button
            onClick={handleRefresh}
            className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
            title="Refresh explorer"
          >
            <RefreshCw className={`size-3 ${rootLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {/* Tree content */}
      <div
        role="tree"
        className="flex-1 overflow-y-auto py-1"
      >
        {rootLoading && !hasRootEntries && (
          <div className="flex items-center gap-1 px-4 h-7 text-[12px] text-text-tertiary animate-pulse">
            Loading...
          </div>
        )}

        {hasRootEntries && (
          <FileTreeNode
            paneId={paneId}
            parentPath=""
            depth={0}
            onFileOpen={onFileOpen}
            onContextMenu={handleContextMenu}
          />
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-border bg-bg-secondary shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-[13px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            onClick={handleCopyPath}
          >
            Copy Path
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-[13px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            onClick={handleCopyRelativePath}
          >
            Copy Relative Path
          </button>
        </div>
      )}
    </div>
  )
}
