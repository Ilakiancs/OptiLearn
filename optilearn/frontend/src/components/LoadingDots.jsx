import Spinner from './Spinner'

export default function LoadingDots() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Spinner size={18} />
    </span>
  )
}
