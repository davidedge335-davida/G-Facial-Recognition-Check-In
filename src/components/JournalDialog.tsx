import React, { useEffect, useRef } from 'react';

interface JournalDialogProps {
  children: React.ReactNode;
  labelledBy: string;
  onClose: () => void;
  className?: string;
  id?: string;
}

/** 共用纸张弹窗：限制 Tab 焦点、支持 Esc，并在关闭后回到原来的按钮。 */
export function JournalDialog({ children, labelledBy, onClose, className = '', id }: JournalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') || [])
      .filter(element => element.getClientRects().length > 0);
    (focusable()[0] || dialog)?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialog?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="journal-dialog-backdrop">
      <div ref={dialogRef} id={id} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className={`card journal-dialog ${className}`}>
        {children}
      </div>
    </div>
  );
}
