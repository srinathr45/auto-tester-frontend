import type { NodeProps } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import StepNodeShell from '../StepNodeShell';
import type { StepCanvasNode } from '../types';

export default function AiFillNode({ data, selected }: NodeProps<StepCanvasNode>) {
  return (
    <StepNodeShell
      data={data}
      selected={selected}
      icon={<Sparkles size={16} />}
      preview={data.goal?.trim() || 'Capture fields to generate a fill script'}
    />
  );
}
