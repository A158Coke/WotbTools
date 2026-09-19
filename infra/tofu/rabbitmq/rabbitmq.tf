# Compose owns the broker process. This root owns only broker configuration.
# Queue, exchange, and binding declarations are application-owned once the
# application gets a RabbitMQ adapter; do not add a second topology owner here.
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

# The isolated vhost is the topology boundary. Until the application declares
# canonical resource names, publisher/consumer capabilities remain scoped by
# operation (write versus read) rather than guessing queue/exchange names.
resource "rabbitmq_permissions" "control_api_publisher" {
  user  = rabbitmq_user.control_api.name
  vhost = rabbitmq_vhost.wotbtools.name

  permissions {
    configure = "^$"
    write     = ".*"
    read      = "^$"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "rabbitmq_permissions" "parser_worker_consumer" {
  user  = rabbitmq_user.parser_worker.name
  vhost = rabbitmq_vhost.wotbtools.name

  permissions {
    configure = "^$"
    write     = "^$"
    read      = ".*"
  }

  lifecycle {
    prevent_destroy = true
  }
}
