import { z } from "zod";

export const PublicUserSchema = z.object({
  username: z.string(),
  id: z.string(),
  email: z.string(),
  isAdmin: z.boolean(),
  firstName: z.string(),
  lastName: z.string(),
  pictureUrl: z.string().optional(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const UserResponseSchema = z.object({ user: PublicUserSchema });
export const UsersResponseSchema = z.object({ users: z.array(PublicUserSchema) });

export const CreateUserRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  isAdmin: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const UpdateUserRequestSchema = z.object({
  enabled: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
  email: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});
