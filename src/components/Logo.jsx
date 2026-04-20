export default function Logo({ className = '', showWordmark = true }) {
  return (
    <span className={`hg-logo ${className}`}>
      <svg
        className="hg-logo__mark"
        viewBox="0 0 400 400"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Hooks Graph logo"
      >
        <circle cx="200" cy="200" r="190" fill="#0b0b0c" />
        <g stroke="#ffffff" strokeWidth="22" strokeLinecap="round">
          <line x1="125" y1="115" x2="125" y2="200" />
          <line x1="125" y1="200" x2="125" y2="285" />
          <line x1="125" y1="200" x2="275" y2="200" />
          <line x1="275" y1="115" x2="275" y2="200" />
          <line x1="275" y1="200" x2="275" y2="285" />
        </g>
        <g fill="#ffffff">
          <circle cx="125" cy="115" r="20" />
          <circle cx="125" cy="200" r="20" />
          <circle cx="125" cy="285" r="20" />
          <circle cx="275" cy="115" r="20" />
          <circle cx="275" cy="200" r="20" />
          <circle cx="275" cy="285" r="20" />
        </g>
      </svg>
      {showWordmark && <span className="hg-logo__wordmark">Hooks Graph</span>}
    </span>
  );
}
