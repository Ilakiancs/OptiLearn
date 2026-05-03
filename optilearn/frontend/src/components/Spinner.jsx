export default function Spinner({ size = 24, color = 'var(--color-primary)' }) {
  return (
    <>
      <style>{`@keyframes _olSpin{to{transform:rotate(360deg)}}`}</style>
      <div style={{
        width: size, height: size, flexShrink: 0,
        border: `3px solid var(--color-border)`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: '_olSpin 0.8s linear infinite',
        display: 'inline-block',
      }} />
    </>
  )
}
