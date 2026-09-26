"""Task module reserved for email background jobs.

No jobs are registered here until the corresponding service has a durable,
idempotent implementation. Keeping the module import-safe prevents worker
startup failures while avoiding fake background work.
"""
