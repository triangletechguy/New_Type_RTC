import { loadingAssets } from '../../assets/rtc/catalog'

export function LoadingMovie({ label = 'Loading', compact = false, inline = false, className = '' }) {
  const classes = [
    'loading-movie',
    compact ? 'compact' : '',
    inline ? 'inline' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} role="status" aria-live="polite">
      <img
        className="loading-movie-icon"
        src={loadingAssets.movie}
        alt=""
        width="150"
        height="150"
        decoding="async"
        loading="eager"
      />
      <span>{label}</span>
    </div>
  )
}
