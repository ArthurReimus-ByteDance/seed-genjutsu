"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { StudioApi } from "@/lib/api";
import type { Upload } from "@/lib/schemas";
import {
  referenceRoles,
  type ReferenceRole,
  type WorkflowId,
} from "@/lib/workflows";
import { UploadTile } from "../upload-tile";
import type { StudioReference } from "./workflow-state";

export function ReferenceTray({
  workflow,
  references,
  disabled,
  apiClient,
  onAdd,
  onRemove,
  onRole,
  onMove,
  onBusyChange,
}: {
  workflow: WorkflowId;
  references: StudioReference[];
  disabled: boolean;
  apiClient: StudioApi;
  onAdd: (media: Upload, role: ReferenceRole) => void;
  onRemove: (id: string) => void;
  onRole: (id: string, role: ReferenceRole) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [role, setRole] = useState<ReferenceRole>(
    workflow === "restyle"
      ? "style"
      : workflow === "element_edit"
        ? "object"
        : "character",
  );
  const [uploading, setUploading] = useState(false);
  return (
    <section className="reference-tray" aria-label="Ordered image references">
      <div className="field-heading">
        <span>Image references</span>
        <span>{references.length}/30</span>
      </div>
      <p className="reference-guidance">
        {workflow === "motion_transfer"
          ? "Add a character, identity, or scene image. Numbering follows this order."
          : "Images are optional. Use Image 1, Image 2, etc. in your direction."}
      </p>
      {!!references.length && (
        <ol className="ordered-references">
          {references.map((reference, index) => (
            <li key={reference.id}>
              <Image
                src={reference.media.url}
                alt={`Image ${index + 1}: ${reference.media.name}`}
                width={48}
                height={48}
                unoptimized
              />
              <div className="reference-copy">
                <strong>Image {index + 1}</strong>
                <span title={reference.media.name}>{reference.media.name}</span>
                <label className="sr-only" htmlFor={`role-${reference.id}`}>
                  Image {index + 1} role
                </label>
                <select
                  id={`role-${reference.id}`}
                  value={reference.role}
                  disabled={disabled}
                  onChange={(event) =>
                    onRole(reference.id, event.target.value as ReferenceRole)
                  }
                >
                  {referenceRoles.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="reference-actions">
                <button
                  type="button"
                  aria-label={`Move Image ${index + 1} earlier`}
                  disabled={disabled || index === 0}
                  onClick={() => onMove(reference.id, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Move Image ${index + 1} later`}
                  disabled={disabled || index === references.length - 1}
                  onClick={() => onMove(reference.id, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove Image ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onRemove(reference.id)}
                >
                  <X size={14} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {!disabled && references.length < 30 && (
        <div className="reference-add">
          <label htmlFor="new-reference-role">New image role</label>
          <select
            id="new-reference-role"
            value={role}
            disabled={uploading}
            onChange={(event) => setRole(event.target.value as ReferenceRole)}
          >
            {referenceRoles.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <UploadTile
            kind="character"
            label="Reference image"
            value={null}
            disabled={disabled}
            apiClient={apiClient}
            onChange={(media) => {
              if (media) onAdd(media, role);
            }}
            onBusyChange={(busy) => {
              setUploading(busy);
              onBusyChange(busy);
            }}
          />
        </div>
      )}
    </section>
  );
}
