import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Repeat } from 'lucide-react';
import { HANDLE } from '../../shared/loopGraph';
import StepNodeShell from '../StepNodeShell';
import { firstScriptLine, type StepCanvasNode } from '../types';

export default function LoopNode({ data, selected }: NodeProps<StepCanvasNode>) {
  const times = Math.max(1, Number(data.loop?.count) || 3);
  const horizontal = data.__flowDir === 'horizontal';
  const navPreview = firstScriptLine(data, '');
  const preview = navPreview ? `× ${times} · ${navPreview}` : `× ${times} times`;

  return (
    <StepNodeShell
      data={data}
      selected={selected}
      icon={<Repeat size={16} />}
      preview={preview}
      extraClassName="is-loop"
      extraHandles={
        <Handle
          id={HANDLE.REPEAT}
          type="source"
          position={horizontal ? Position.Top : Position.Left}
          className="flow-step-handle flow-step-handle-repeat"
          isConnectable
          title="Repeat to — connect to the first step of the loop body"
        />
      }
    />
  );
}
