import { useEffect, useRef } from 'react';
import { AvatarViewer } from '../avatar/AvatarViewer';

export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const viewer = new AvatarViewer(container);
    void viewer.load();

    return () => viewer.dispose();
  }, []);

  return <div ref={containerRef} className="avatar-container" aria-label="Aether avatar viewer" />;
}
