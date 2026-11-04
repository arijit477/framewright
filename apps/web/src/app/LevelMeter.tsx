import { useEffect, useRef } from 'react';
import { audio, useEditor } from '../store/editor';

/** Stereo peak meter, updated outside React for smoothness. */
export function LevelMeter() {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const playing = useEditor((s) => s.playing);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const [l, r] = audio.levels();
      if (left.current) left.current.style.transform = `scaleX(${Math.min(1, l)})`;
      if (right.current) right.current.style.transform = `scaleX(${Math.min(1, r)})`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  return (
    <div className="meter" title="Output level" aria-hidden="true">
      <div className="meter-bar">
        <div ref={left} className="meter-fill" />
      </div>
      <div className="meter-bar">
        <div ref={right} className="meter-fill" />
      </div>
    </div>
  );
}
