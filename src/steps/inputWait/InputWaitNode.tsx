import type { NodeProps } from '@xyflow/react';
import { Clock } from 'lucide-react';
import StepNodeShell from '../StepNodeShell';
import { firstScriptLine, type StepCanvasNode } from '../types';

export default function InputWaitNode({ data, selected }: NodeProps<StepCanvasNode>) {
  const preview = (data.description || '').trim() || firstScriptLine(data);
  return (
    <StepNodeShell
      data={data}
      selected={selected}
      icon={<Clock size={16} />}
      preview={preview}
    />
  );
}
