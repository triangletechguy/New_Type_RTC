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
      <img className="loading-movie-icon" src={loadingAssets.movie} alt="" decoding="async" />
      <span>{label}</span>
    </div>
  )
}
