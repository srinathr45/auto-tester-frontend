import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { HANDLE } from '../shared/loopGraph';
import { resolveStepKind, stepKindOption } from '../shared/stepKinds';
import type { StepCanvasData } from './types';

interface StepNodeShellProps {
  data: StepCanvasData;
  selected: boolean;
  icon: ReactNode;
  preview: string;
  extraClassName?: string;
  extraHandles?: ReactNode;
}

/**
 * Shared canvas chrome for every step kind: in/out handles, title, kind badge.
 * Kind folders pass icon, preview, and any extra handles (e.g. Loop Repeat).
 */
export default function StepNodeShell({
  data,
  selected,
  icon,
  preview,
  extraClassName,
  extraHandles,
}: StepNodeShellProps) {
  const kind = resolveStepKind(data);
  const kindLabel = stepKindOption(kind).menuLabel;
  const highlighted = Boolean(data.__highlighted);
  const horizontal = data.__flowDir === 'horizontal';

  return (
    <div
      className={`flow-step-node${selected ? ' is-selected' : ''}${highlighted ? ' is-running' : ''}${
        extraClassName ? ` ${extraClassName}` : ''
      }`}
    >
      <Handle
        id={HANDLE.IN}
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        className="flow-step-handle"
        // Receives the linear previous edge and Loop "repeat to" connections.
        isConnectable
      />

      <div className="flow-step-node-head">
        <div className="flow-step-node-icon">{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flow-step-node-title">{data.label || 'Step'}</div>
          <div className="flow-step-node-kind">{kindLabel}</div>
        </div>
        <span className="badge-script">{kindLabel}</span>
      </div>

      <div className="flow-step-node-preview">{preview}</div>

      <Handle
        id={HANDLE.OUT}
        type="source"
        position={horizontal ? Position.Right : Position.Bottom}
        className="flow-step-handle"
        isConnectable={false}
      />

      {extraHandles}
    </div>
  );
}
