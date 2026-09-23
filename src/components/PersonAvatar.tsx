import React, { useEffect, useState } from 'react';

interface PersonAvatarProps {
  name: string;
  src: string;
  className?: string;
}

/** 外链头像加载失败时保留姓名标记，避免手帐相册出现破图。 */
export function PersonAvatar({ name, src, className = '' }: PersonAvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return failed || !src ? (
    <span className={`avatar-placeholder ${className}`} role="img" aria-label={name}>
      {Array.from(name)[0] || '人'}
    </span>
  ) : (
    <img src={src} alt={name} className={className} onError={() => setFailed(true)} />
  );
}
