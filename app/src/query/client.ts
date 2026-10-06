import { QueryClient } from "@tanstack/react-query";

/// One client for the `/app` tree. Sign-out clears it so a previous party's queries can't resurface.
export const queryClient = new QueryClient();
