"use client";

import type { CreateJob } from "@/lib/schemas";
import {
  workflowIds,
  workflows,
  stylePresetIds,
  stylePresets,
  type WorkflowId,
  type StylePresetId,
} from "@/lib/workflows";

export function WorkflowControls({
  workflow,
  operation,
  stylePreset,
  disabled,
  onWorkflow,
  onOperation,
  onStylePreset,
}: {
  workflow: WorkflowId;
  operation: CreateJob["operation"];
  stylePreset: StylePresetId;
  disabled: boolean;
  onWorkflow: (workflow: WorkflowId) => void;
  onOperation: (operation: CreateJob["operation"]) => void;
  onStylePreset: (preset: StylePresetId) => void;
}) {
  return (
    <div className="workflow-controls">
      <label htmlFor="workflow">Workflow</label>
      <select
        id="workflow"
        value={workflow}
        disabled={disabled}
        aria-describedby="workflow-description"
        onChange={(event) => onWorkflow(event.target.value as WorkflowId)}
      >
        {workflowIds.map((id) => (
          <option key={id} value={id}>
            {workflows[id].label}
          </option>
        ))}
      </select>
      <p id="workflow-description">{workflows[workflow].description}</p>
      {workflow === "element_edit" && (
        <>
          <label htmlFor="edit-operation">Edit operation</label>
          <select
            id="edit-operation"
            value={operation}
            disabled={disabled}
            onChange={(event) =>
              onOperation(event.target.value as CreateJob["operation"])
            }
          >
            <option value="modify">Modify</option>
            <option value="replace">Replace</option>
            <option value="add">Add</option>
            <option value="remove">Remove</option>
          </select>
        </>
      )}
      {workflow === "restyle" && (
        <>
          <label htmlFor="style-preset">Style preset</label>
          <select
            id="style-preset"
            value={stylePreset}
            disabled={disabled}
            aria-describedby="preset-direction"
            onChange={(event) =>
              onStylePreset(event.target.value as StylePresetId)
            }
          >
            {stylePresetIds.map((id) => (
              <option key={id} value={id}>
                {stylePresets[id].label}
              </option>
            ))}
          </select>
          <p id="preset-direction">
            {stylePresets[stylePreset].direction ||
              "Add a style image or write your own direction below."}
          </p>
        </>
      )}
    </div>
  );
}
