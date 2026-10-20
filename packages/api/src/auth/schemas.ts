import { z } from "zod";

export const LoginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const ResetRequestSchema = z.object({ username: z.string() });

export const ResetLinkRequestSchema = z.object({ username: z.string() });

export const ResetConfirmSchema = z.object({
  token: z.string(),
  password: z.string(),
});

export const ResetLinkResponseSchema = z.object({ username: z.string(), url: z.string() });
