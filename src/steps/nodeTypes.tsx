import { memo, type ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import { resolveStepKind } from '../shared/stepKinds';
import type { StepKind } from '../shared/types';
import AiFillNode from './aiFill/AiFillNode';
import AiScriptNode from './aiScript/AiScriptNode';
import ApiValidateNode from './apiValidate/ApiValidateNode';
import FrontendValidatorNode from './frontendValidator/FrontendValidatorNode';
import InputWaitNode from './inputWait/InputWaitNode';
import LoopNode from './loop/LoopNode';
import ScriptNode from './script/ScriptNode';
import type { StepCanvasNode } from './types';

const KIND_NODES: Record<StepKind, ComponentType<NodeProps<StepCanvasNode>>> = {
  script: ScriptNode,
  aiFill: AiFillNode,
  inputWait: InputWaitNode,
  aiScript: AiScriptNode,
  loop: LoopNode,
  patternValidate: FrontendValidatorNode,
  apiValidate: ApiValidateNode,
};

/** One React Flow type so saved graphs keep `type: 'customStep'`. */
function CustomStepNode(props: NodeProps<StepCanvasNode>) {
  const kind = resolveStepKind(props.data);
  const KindNode = KIND_NODES[kind];
  return <KindNode {...props} />;
}

export const nodeTypes = {
  customStep: memo(CustomStepNode),
};

export type { StepCanvasData, StepCanvasNode } from './types';
