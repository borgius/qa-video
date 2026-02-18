import { useState } from 'react';

interface SlideImageProps {
  src: string;
  alt: string;
}

export function SlideImage({ src, alt }: SlideImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          display: loaded ? 'block' : 'none',
        }}
      />
      {!loaded && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255, 255, 255, 0.4)',
          fontSize: '16px',
        }}>
          Loading slide...
        </div>
      )}
    </>
  );
}
