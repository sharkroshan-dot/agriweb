export function Footer() {
	return (
		<footer className="border-t bg-white">
			<div className="mx-auto max-w-7xl px-6 py-6 text-sm text-slate-500 lg:px-8">
				<div className="flex flex-col items-center justify-between gap-3 lg:flex-row">
					<p>© 2026 AgriConnect. Connecting farmers and buyers.</p>
					<div className="flex gap-4">
						<a href="#" className="hover:underline">Privacy</a>
						<a href="#" className="hover:underline">Terms</a>
						<a href="#" className="hover:underline">Contact</a>
					</div>
				</div>
			</div>
		</footer>
	);
}
