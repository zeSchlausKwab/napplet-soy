import { useId, type ComponentProps, type ReactNode } from 'react';
import { AlertCircle, Check, LoaderCircle, X } from 'lucide-react';
import { Button } from './ui/button';

type Props = ComponentProps<typeof Button> & {
  icon?: ReactNode;
  working?: string;
  error?: string;
  retryLabel?: string;
  success?: string;
  compact?: boolean;
  onCancel?: () => void;
};

/** Delivery belongs to the initiating control; error detail remains accessible without a status row. */
export function ActionButton({
  icon,
  working,
  error,
  retryLabel = 'Retry',
  success,
  compact = false,
  onCancel,
  children,
  ...props
}: Props) {
  const statusId = useId();
  const status = working || error || success || '';
  return (
    <span className="action-control">
      <Button
        {...props}
        disabled={props.disabled || !!working}
        aria-busy={!!working}
        aria-label={working || (error ? retryLabel : props['aria-label'] || success)}
        aria-describedby={status ? statusId : props['aria-describedby']}
        title={error ? `${error} ${retryLabel}.` : working || success || props.title}
        data-action-state={working ? 'working' : error ? 'error' : success ? 'success' : 'idle'}
        className={`action-button ${props.className ?? ''}`}
      >
        {working ? (
          <LoaderCircle size={16} className="animate-spin" aria-hidden />
        ) : error ? (
          <AlertCircle size={16} aria-hidden />
        ) : success ? (
          <Check size={16} aria-hidden />
        ) : (
          icon
        )}
        {compact ? children : working || (error ? retryLabel : success || children)}
        <span id={statusId} className="sr-only" role="status">
          {status}
        </span>
      </Button>
      {onCancel && error && !working && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="cancel-action"
          aria-label="Stop retrying this action"
          title="Stop retrying and refresh. The action may already have arrived."
          onClick={onCancel}
        >
          <X size={12} />
        </Button>
      )}
    </span>
  );
}
