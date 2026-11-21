import type { Status } from './sync/controller'
import { visualState } from './sync/messages'
import type { SyncVisualState } from './sync/messages'
import './SyncIcon.css'

export interface SyncIconProps {
  status?: Status
  state?: SyncVisualState
  size?: number
  className?: string
}

export default function SyncIcon({
  status,
  state: explicitState,
  size = 18,
  className = '',
}: SyncIconProps) {
  const current = explicitState ?? (status ? visualState(status) : 'off')

  if (current === 'synced') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`sync-icon sync-icon-synced ${className}`}
      >
        <path d="M16.5 13.5A4.5 4.5 0 0 0 15 5.5a6 6 0 0 0-11 2 4 4 0 0 0 .5 8h12z" />
        <path d="m7.5 10.5 2 2 3.5-3.5" />
      </svg>
    )
  }

  if (current === 'syncing') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`sync-icon sync-icon-syncing ${className}`}
      >
        <path d="M17 10a7 7 0 0 1-12 5M3 10a7 7 0 0 1 12-5" />
        <path d="M17 5v5h-5M3 15v-5h5" />
      </svg>
    )
  }

  if (current === 'offline') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`sync-icon sync-icon-offline ${className}`}
      >
        <path d="m2 2 16 16" />
        <path d="M6 6A6 6 0 0 0 4 7.5a4 4 0 0 0 .5 8H14" />
        <path d="M16.5 13.5a4.5 4.5 0 0 0-1.7-3.5 6 6 0 0 0-4.3-4.4" />
      </svg>
    )
  }

  if (current === 'error') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`sync-icon sync-icon-error ${className}`}
      >
        <path d="M16.5 13.5A4.5 4.5 0 0 0 15 5.5a6 6 0 0 0-11 2 4 4 0 0 0 .5 8h12z" />
        <line x1="10" y1="8" x2="10" y2="11" />
        <circle cx="10" cy="13.5" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`sync-icon sync-icon-off ${className}`}
    >
      <path d="M16.5 13.5A4.5 4.5 0 0 0 15 5.5a6 6 0 0 0-11 2 4 4 0 0 0 .5 8h12z" />
    </svg>
  )
}
