"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ArrowRight, Fingerprint } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, queryKeys } from "@/lib/api";
import { toast } from "sonner";
const schema = z.object({
  name: z.string().max(80),
  email: z.email(),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
  inviteCode: z.string().max(200),
});
type Fields = z.infer<typeof schema>;
export function AuthDialog({
  open,
  onOpenChange,
  registration,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registration: boolean;
}) {
  const [register, setRegister] = useState(false);
  const client = useQueryClient();
  const form = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", inviteCode: "" },
  });
  const mutation = useMutation({
    mutationFn: (input: Fields) =>
      register ? api.register(input) : api.login(input),
    onSuccess: async (result) => {
      client.clear();
      client.setQueryData(queryKeys.session, {
        user: result.user,
        registration,
      });
      onOpenChange(false);
      form.reset();
      toast.success("Welcome to your studio.");
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="auth-dialog sm:max-w-[420px]">
        <div className="auth-mark">
          <Fingerprint size={25} />
        </div>
        <DialogTitle className="text-2xl tracking-tight">
          {register ? "Make room for your next idea." : "Back to your studio."}
        </DialogTitle>
        <DialogDescription>
          Your references, generations, and creative workspace. All in one
          place.
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          {register && (
            <label className="field-label">
              Your name
              <Input
                autoComplete="name"
                placeholder="Alex Morgan"
                {...form.register("name")}
              />
            </label>
          )}
          <label className="field-label">
            Email
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...form.register("email")}
            />
          </label>
          <label className="field-label">
            Password
            <Input
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              placeholder="At least 12 characters"
              {...form.register("password")}
            />
          </label>
          {register && (
            <label className="field-label">
              Invite code{" "}
              <span className="font-normal text-muted-foreground">
                (if provided)
              </span>
              <Input
                autoComplete="off"
                placeholder="Workspace invite"
                {...form.register("inviteCode")}
              />
            </label>
          )}
          {(mutation.error || Object.values(form.formState.errors)[0]) && (
            <p role="alert" className="text-sm text-red-400">
              {mutation.error?.message ??
                Object.values(form.formState.errors)[0]?.message}
            </p>
          )}
          <Button
            className="h-11 w-full"
            type="submit"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <>
                {register ? "Create account" : "Sign in"}
                <ArrowRight className="ml-auto" size={16} />
              </>
            )}
          </Button>
        </form>
        {registration && (
          <button
            type="button"
            className="auth-mode"
            onClick={() => {
              setRegister(!register);
              mutation.reset();
            }}
          >
            {register
              ? "Already have a workspace? Sign in"
              : "New here? Create your account"}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
