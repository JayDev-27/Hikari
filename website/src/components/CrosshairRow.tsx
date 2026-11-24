import { useEffect, useRef, useState } from 'react';

interface CrosshairRowProps {
  count?: number;
  className?: string;
}

export function CrosshairRow({ count = 5, className = '' }: CrosshairRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rowRef}
      className={`crosshair-row ${visible ? 'is-visible' : ''} ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <span
          key={idx}
          className="crosshair-plus"
          style={{ transitionDelay: `${idx * 45}ms` }}
        />
      ))}
    </div>
  );
}
