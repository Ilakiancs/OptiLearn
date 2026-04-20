const style = `
@keyframes dotPulse {
  0%, 100% { opacity: 0.2; transform: scale(0.8); }
  50%       { opacity: 1;   transform: scale(1);   }
}
.loading-dots span {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
  margin: 0 3px;
  animation: dotPulse 1.2s ease-in-out infinite;
}
.loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.loading-dots span:nth-child(3) { animation-delay: 0.4s; }
`

export default function LoadingDots() {
  return (
    <>
      <style>{style}</style>
      <span className="loading-dots">
        <span />
        <span />
        <span />
      </span>
    </>
  )
}
