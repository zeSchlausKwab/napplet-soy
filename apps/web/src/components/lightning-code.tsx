import { useEffect, useRef, useState } from 'react';

/** Local encoding: no payment identifier is sent to a third-party QR service. */
export function LightningCode({
  value,
  label,
  preserveCase = false,
}: {
  value: string;
  label: string;
  preserveCase?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    setMessage('');
    import('qrcode')
      .then(({ default: qr }) => {
        if (!cancelled && canvas.current)
          return qr.toCanvas(canvas.current, preserveCase ? value : value.toUpperCase(), {
            width: 280,
            margin: 4,
            errorCorrectionLevel: 'M',
          });
      })
      .catch(() => {
        if (!cancelled) setMessage('QR unavailable. Use the link or copy the code.');
      });
    return () => {
      cancelled = true;
    };
  }, [value, preserveCase]);
  return (
    <div className="lightning-code">
      <canvas ref={canvas} role="img" aria-label={label} />
      {message && <p role="status">{message}</p>}
    </div>
  );
}
