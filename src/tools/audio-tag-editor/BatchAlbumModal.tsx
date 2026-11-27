import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Layers, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IMAGE_ACCEPT } from '@/lib/image'
import { prepareCoverImageFromFile } from './engine'
import { GENRE_SUGGESTIONS, type BatchEditDraft, type CoverArtData } from './types'

interface BatchAlbumModalProps {
  open: boolean
  writableCount: number
  onClose: () => void
  onApply: (draft: BatchEditDraft) => void
}

const inputCls =
  'border-border/70 bg-background/70 focus:border-primary focus:ring-primary/20 w-full rounded-xl border px-3 py-1.5 text-xs transition outline-none focus:ring-2 disabled:opacity-45'

export function BatchAlbumModal({ open, writableCount, onClose, onApply }: BatchAlbumModalProps) {
  const [draft, setDraft] = useState<BatchEditDraft>({
    applyArtist: false,
    artist: '',
    applyAlbum: false,
    album: '',
    applyAlbumArtist: false,
    albumArtist: '',
    applyYear: false,
    year: '',
    applyGenre: false,
    genre: '',
    applyCover: false,
    cover: null,
    clearCover: false,
  })
  const [loadingCover, setLoadingCover] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const handleCoverPick = async (file?: File) => {
    if (!file) return
    setLoadingCover(true)
    try {
      const prepared: CoverArtData = await prepareCoverImageFromFile(file)
      setDraft((prev) => ({
        ...prev,
        applyCover: true,
        clearCover: false,
        cover: prepared,
      }))
      toast.success(`已准备统一封面（${prepared.width}×${prepared.height}）`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '封面解析失败')
    } finally {
      setLoadingCover(false)
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
  }

  const anySelected =
    draft.applyArtist ||
    draft.applyAlbum ||
    draft.applyAlbumArtist ||
    draft.applyYear ||
    draft.applyGenre ||
    draft.applyCover

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card-solid border-border shadow-2xl flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border/70 flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Layers className="text-primary size-4.5" />
            <div>
              <h3 className="text-sm font-semibold">整张专辑批量修改</h3>
              <p className="text-muted-foreground text-[11px]">
                勾选需要统一覆写的字段，将批量应用到全部 {writableCount} 首可写回歌曲（MP3 / FLAC / M4A）
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto p-5 text-xs">
          {/* 歌手 */}
          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={draft.applyArtist}
                onChange={(e) => setDraft((p) => ({ ...p, applyArtist: e.target.checked }))}
                className="accent-primary rounded"
              />
              统一修改歌手
            </label>
            <input
              type="text"
              disabled={!draft.applyArtist}
              value={draft.artist}
              onChange={(e) => setDraft((p) => ({ ...p, artist: e.target.value }))}
              placeholder="例如：周杰伦"
              className={inputCls}
            />
          </div>

          {/* 专辑名 */}
          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={draft.applyAlbum}
                onChange={(e) => setDraft((p) => ({ ...p, applyAlbum: e.target.checked }))}
                className="accent-primary rounded"
              />
              统一修改专辑名称
            </label>
            <input
              type="text"
              disabled={!draft.applyAlbum}
              value={draft.album}
              onChange={(e) => setDraft((p) => ({ ...p, album: e.target.value }))}
              placeholder="例如：十一月的萧邦"
              className={inputCls}
            />
          </div>

          {/* 专辑艺术家 */}
          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={draft.applyAlbumArtist}
                onChange={(e) => setDraft((p) => ({ ...p, applyAlbumArtist: e.target.checked }))}
                className="accent-primary rounded"
              />
              统一修改专辑艺术家
            </label>
            <input
              type="text"
              disabled={!draft.applyAlbumArtist}
              value={draft.albumArtist}
              onChange={(e) => setDraft((p) => ({ ...p, albumArtist: e.target.value }))}
              placeholder="例如：Various Artists 或主唱名"
              className={inputCls}
            />
          </div>

          {/* 年份与流派 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={draft.applyYear}
                  onChange={(e) => setDraft((p) => ({ ...p, applyYear: e.target.checked }))}
                  className="accent-primary rounded"
                />
                发行年份
              </label>
              <input
                type="text"
                disabled={!draft.applyYear}
                value={draft.year}
                onChange={(e) => setDraft((p) => ({ ...p, year: e.target.value }))}
                placeholder="例如：2005"
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={draft.applyGenre}
                  onChange={(e) => setDraft((p) => ({ ...p, applyGenre: e.target.checked }))}
                  className="accent-primary rounded"
                />
                音乐流派
              </label>
              <input
                type="text"
                list="batch-genre-options"
                disabled={!draft.applyGenre}
                value={draft.genre}
                onChange={(e) => setDraft((p) => ({ ...p, genre: e.target.value }))}
                placeholder="例如：华语流行"
                className={inputCls}
              />
              <datalist id="batch-genre-options">
                {GENRE_SUGGESTIONS.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
          </div>

          {/* 统一专辑封面 */}
          <div className="border-border/60 space-y-2.5 rounded-xl border p-3">
            <label className="flex cursor-pointer items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={draft.applyCover}
                onChange={(e) => setDraft((p) => ({ ...p, applyCover: e.target.checked }))}
                className="accent-primary rounded"
              />
              统一修改 / 清除专辑封面
            </label>

            {draft.applyCover && (
              <div className="flex items-center gap-3">
                <div className="bg-foreground/[0.05] border-border/70 flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border">
                  {draft.cover && !draft.clearCover ? (
                    <img src={draft.cover.previewUrl} alt="封面预览" className="size-full object-cover" />
                  ) : (
                    <ImagePlus className="text-muted-foreground size-5" />
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingCover}
                    onClick={() => coverInputRef.current?.click()}
                  >
                    <ImagePlus />
                    {draft.cover ? '重新选封面' : '选择新封面图'}
                  </Button>
                  <Button
                    variant={draft.clearCover ? 'danger' : 'ghost'}
                    size="sm"
                    onClick={() => setDraft((p) => ({ ...p, clearCover: !p.clearCover, cover: null }))}
                  >
                    <Trash2 />
                    {draft.clearCover ? '将清除全部封面' : '清空封面'}
                  </Button>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept={IMAGE_ACCEPT}
                    className="hidden"
                    onChange={(e) => void handleCoverPick(e.target.files?.[0])}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-border/70 flex justify-end gap-2 border-t px-5 py-3.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!anySelected || writableCount === 0}
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            应用到 {writableCount} 首歌曲
          </Button>
        </div>
      </div>
    </div>
  )
}
