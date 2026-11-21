import { useEffect, useRef, type ReactNode } from 'react';

// A lightweight anchored floating panel. Closes on outside click or Escape.
export default function Popup({
  onClose,
  align = 'left',
  children,
}: {
  onClose: () => void;
  align?: 'left' | 'right' | 'center';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={`popup popup-${align}`}>
      {children}
    </div>
  );
}
