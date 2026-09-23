export async function GET() {
  return new Response("Stripe webhook endpoint ready", { status: 200 });
}

export async function POST() {
  return new Response("Stripe webhook endpoint ready", { status: 200 });
}
