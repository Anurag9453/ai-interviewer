import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminRequest } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";

const PatchSchema = z.object({ active: z.boolean() });

/** Activate/deactivate a promo — the only field an admin can flip post-creation without a new migration. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkAdminRequest();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const { id } = await params;
  const service = createServiceClient();
  const { data, error } = await service.from("promotions").update({ active: parsed.data.active }).eq("id", id).select("*").single();
  if (error || !data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ promotion: data });
}
