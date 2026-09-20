# Compose owns the broker runtime. This root owns every static broker
# configuration object.
#
# Static RabbitMQ topology is OpenTofu-owned. Applications only publish/consume
# and implement runtime messaging semantics (ack/nack, retry decisions,
# idempotency, job state machine, business workflow, message payload schema).
#
# There is exactly ONE topology owner: this root. Never let Spring AMQP or any
# application startup declare these exchanges, queues, or bindings. A second
# owner makes the broker fail with PRECONDITION_FAILED as soon as the declared
# arguments differ, and it turns a reviewed OpenTofu diff into an invisible
# runtime side effect.
resource "rabbitmq_vhost" "wotbtools" {
  name = "/wotbtools"

  lifecycle {
    prevent_destroy = true
  }
}

resource "rabbitmq_user" "control_api" {
  name     = "control-api"
  password = var.control_api_password
  tags     = []

  lifecycle {
    prevent_destroy = true
  }
}

resource "rabbitmq_user" "parser_worker" {
  name     = "parser-worker"
  password = var.parser_worker_password
  tags     = []

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  # Canonical static topology. These names are the single source of truth for
  # the broker, the deployment contract test, and the disposable smoke.
  jobs_exchange = "wotb.jobs"

  parser_queue        = "wotb.parser"
  parser_retry_queue  = "wotb.parser.retry"
  parser_dlq          = "wotb.parser.dlq"
  parser_result_queue = "wotb.parser.result"

  parser_request_routing_key = "parser.request"
  parser_retry_routing_key   = "parser.retry"
  parser_dead_routing_key    = "parser.dead"
  parser_result_routing_key  = "parser.result"
  parser_failed_routing_key  = "parser.failed"

  # RabbitMQ resolves every queue to a concrete queue type and always reports it
  # back as the `x-queue-type` argument, even when the declaration omitted it.
  # Declaring it explicitly keeps the declared arguments identical to the
  # observed ones, which is what stops the provider from planning a replacement
  # on every subsequent run.
  queue_type = "classic"

  # Broker-side retry delay. The broker only holds a rejected message back for
  # this long; retry counters, attempt limits and job state stay in PostgreSQL,
  # which remains the single source of truth for job lifecycle.
  parser_retry_ttl_ms = 30000
}

# `topic` is a deliberate forward-compatible choice, not a routing requirement:
# a later version can add wildcard bindings (`parser.*`, `export.*`) without
# replacing the exchange, and changing an exchange type is a destructive
# replacement of a `prevent_destroy` resource. Version 1 binds and publishes
# only exact routing keys, so the wildcard capability stays unused and the
# routing table stays deterministic. A `direct` exchange would route today's
# exact keys just as well, but it would have to be replaced to ever gain
# wildcard routing.
resource "rabbitmq_exchange" "jobs" {
  name  = local.jobs_exchange
  vhost = rabbitmq_vhost.wotbtools.name

  settings {
    type        = "topic"
    durable     = true
    auto_delete = false
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Rejecting a message without requeue dead-letters it to the retry queue, which
# never has a consumer. `exclusive` queues are connection-scoped and cannot be
# expressed as a static broker object, so every queue declared here is
# non-exclusive by construction; `auto_delete = false` keeps them alive without
# a consumer.
resource "rabbitmq_queue" "parser" {
  name  = local.parser_queue
  vhost = rabbitmq_vhost.wotbtools.name

  settings {
    durable     = true
    auto_delete = false

    # Values are typed JSON: `x-message-ttl` has to reach the broker as an
    # integer, which the plain string map cannot express.
    arguments_json = jsonencode({
      "x-queue-type"              = local.queue_type
      "x-dead-letter-exchange"    = local.jobs_exchange
      "x-dead-letter-routing-key" = local.parser_retry_routing_key
    })
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "rabbitmq_queue" "parser_retry" {
  name  = local.parser_retry_queue
  vhost = rabbitmq_vhost.wotbtools.name

  settings {
    durable     = true
    auto_delete = false

    arguments_json = jsonencode({
      "x-queue-type"              = local.queue_type
      "x-message-ttl"             = local.parser_retry_ttl_ms
      "x-dead-letter-exchange"    = local.jobs_exchange
      "x-dead-letter-routing-key" = local.parser_request_routing_key
    })
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Terminal failures only. No TTL: an operator inspects and replays these
# messages deliberately, and the broker must never discard them on its own.
resource "rabbitmq_queue" "parser_dlq" {
  name  = local.parser_dlq
  vhost = rabbitmq_vhost.wotbtools.name

  settings {
    durable     = true
    auto_delete = false

    arguments_json = jsonencode({
      "x-queue-type" = local.queue_type
    })
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Result path back to the replay control plane: the worker reports per-source
# outcomes with `parser.result` and whole-attempt failures with `parser.failed`.
# A report the control plane cannot apply is dead-lettered to the same DLQ as a
# worker-published terminal failure, so an operator inspects one place. Like the
# DLQ it has no TTL: a message the control plane failed to apply must be replayed
# deliberately, never discarded by the broker on its own.
resource "rabbitmq_queue" "parser_result" {
  name  = local.parser_result_queue
  vhost = rabbitmq_vhost.wotbtools.name

  settings {
    durable     = true
    auto_delete = false

    arguments_json = jsonencode({
      "x-queue-type"              = local.queue_type
      "x-dead-letter-exchange"    = local.jobs_exchange
      "x-dead-letter-routing-key" = local.parser_dead_routing_key
    })
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "rabbitmq_binding" "parser_request" {
  source           = rabbitmq_exchange.jobs.name
  vhost            = rabbitmq_vhost.wotbtools.name
  destination      = rabbitmq_queue.parser.name
  destination_type = "queue"
  routing_key      = local.parser_request_routing_key

  lifecycle {
    prevent_destroy = true
  }
}

resource "rabbitmq_binding" "parser_retry" {
  source           = rabbitmq_exchange.jobs.name
  vhost            = rabbitmq_vhost.wotbtools.name
  destination      = rabbitmq_queue.parser_retry.name
  destination_type = "queue"
  routing_key      = local.parser_retry_routing_key

  lifecycle {
    prevent_destroy = true
  }
}

resource "rabbitmq_binding" "parser_dead" {
  source           = rabbitmq_exchange.jobs.name
  vhost            = rabbitmq_vhost.wotbtools.name
  destination      = rabbitmq_queue.parser_dlq.name
  destination_type = "queue"
  routing_key      = local.parser_dead_routing_key

  lifecycle {
    prevent_destroy = true
  }
}

# Both result routing keys land on the same queue: a per-source outcome and a
# whole-attempt failure are two shapes of the same report, and the control plane
# reads one queue either way. Two bindings rather than one wildcard keep the
# routing table exact for version 1.
resource "rabbitmq_binding" "parser_result" {
  source           = rabbitmq_exchange.jobs.name
  vhost            = rabbitmq_vhost.wotbtools.name
  destination      = rabbitmq_queue.parser_result.name
  destination_type = "queue"
  routing_key      = local.parser_result_routing_key

  lifecycle {
    prevent_destroy = true
  }
}

resource "rabbitmq_binding" "parser_failed" {
  source           = rabbitmq_exchange.jobs.name
  vhost            = rabbitmq_vhost.wotbtools.name
  destination      = rabbitmq_queue.parser_result.name
  destination_type = "queue"
  routing_key      = local.parser_failed_routing_key

  lifecycle {
    prevent_destroy = true
  }
}

# `control-api` dispatches jobs and consumes their outcomes: it may publish to
# the job exchange, may not declare topology, and may read only the result
# queue. It still cannot read `wotb.parser` — the work queue belongs to the
# worker, and a control plane that could consume requests would compete with it.
# Routing keys are not part of a RabbitMQ ACL, so the write grant names the
# exchange rather than a single routing key.
resource "rabbitmq_permissions" "control_api_publisher" {
  user  = rabbitmq_user.control_api.name
  vhost = rabbitmq_vhost.wotbtools.name

  permissions {
    configure = "^$"
    write     = "^wotb\\.jobs$"
    read      = "^wotb\\.parser\\.result$"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# `parser-worker` consumes only the main parser queue. It cannot consume the
# retry queue, which would defeat the broker-side delay, and cannot read the
# DLQ. The write grant exists for exactly one reason: publishing a terminal
# failure to `wotb.jobs` with the `parser.dead` routing key. Ack, nack and
# dead-lettering are not ACL-checked, so no further write surface is granted.
resource "rabbitmq_permissions" "parser_worker_consumer" {
  user  = rabbitmq_user.parser_worker.name
  vhost = rabbitmq_vhost.wotbtools.name

  permissions {
    configure = "^$"
    write     = "^wotb\\.jobs$"
    read      = "^wotb\\.parser$"
  }

  lifecycle {
    prevent_destroy = true
  }
}
