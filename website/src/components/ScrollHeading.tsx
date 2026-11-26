interface ScrollHeadingProps {
  first: string;
  second?: string;
  id?: string;
  className?: string;
}

export function ScrollHeading({ first, second, id, className = '' }: ScrollHeadingProps) {
  return (
    <h2 id={id} className={`scroll-heading ${className}`} data-reveal>
      <span className="reveal-window"><span>{first}</span></span>
      {second && <span className="reveal-window"><em>{second}</em></span>}
    </h2>
  );
}
