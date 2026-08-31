#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_PATH="${1:-$ROOT_DIR/docs/architecture/control-api-native-benchmark.md}"
NETWORK="wotb-control-native-poc-net"
POSTGRES_CONTAINER="wotb-control-native-poc-postgres"
JVM_CONTAINER="wotb-control-native-poc-jvm"
NATIVE_CONTAINER="wotb-control-native-poc-native"
JVM_IMAGE="wotbtools-control:jvm-poc"
NATIVE_IMAGE="wotbtools-control:native-poc"
JVM_PORT=18090
NATIVE_PORT=18092
MANAGEMENT_PORT=18091
NATIVE_MANAGEMENT_PORT=18093
REQUESTS="${CONTROL_POC_REQUESTS:-100}"
TMP_DIR="$(mktemp -d)"

cleanup() {
    docker rm -f "$JVM_CONTAINER" "$NATIVE_CONTAINER" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

timestamp_ms() {
    date +%s%3N
}

build_image() {
    local label="$1"
    local dockerfile="$2"
    local image="$3"
    local log_file="$TMP_DIR/$label-build.log"
    local start end

    start="$(timestamp_ms)"
    if ! docker build --no-cache --progress=plain -f "$ROOT_DIR/$dockerfile" -t "$image" "$ROOT_DIR" >"$log_file" 2>&1; then
        tail -n 80 "$log_file"
        return 1
    fi
    end="$(timestamp_ms)"
    printf '%s\t%s\t%s\t%s\n' "$label" "$((end - start))" "$(docker image inspect -f '{{.Size}}' "$image")" "$log_file"
}

run_workload() {
    local label="$1"
    local image="$2"
    local container="$3"
    local port="$4"
    local management_port="$5"
    local startup_start startup_end startup_ms deadline
    local latency_file="$TMP_DIR/$label-latencies.txt"
    local stats

    docker run -d --name "$container" --network "$NETWORK" \
        -p "$port:8090" -p "$management_port:8091" \
        -e CONTROL_SERVER_PORT=8090 \
        -e CONTROL_MANAGEMENT_PORT=8091 \
        -e CONTROL_POSTGRES_HOST=postgres \
        -e CONTROL_POSTGRES_DB=postgres \
        -e CONTROL_POSTGRES_USER=postgres \
        -e CONTROL_POSTGRES_PASSWORD= \
        -e SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWK_SET_URI=http://127.0.0.1:9/unused \
        "$image" >/dev/null

    startup_start="$(timestamp_ms)"
    deadline="$((startup_start + 120000))"
    until curl --fail --silent --show-error "http://127.0.0.1:$management_port/actuator/health" >/dev/null; do
        if (( $(timestamp_ms) >= deadline )); then
            docker logs "$container"
            return 1
        fi
        sleep 0.1
    done
    startup_end="$(timestamp_ms)"
    startup_ms="$((startup_end - startup_start))"

    : > "$latency_file"
    for ((i = 0; i < REQUESTS; i++)); do
        curl --fail --silent --show-error \
            -o /dev/null -w '%{time_total}\n' \
            "http://127.0.0.1:$management_port/actuator/health" >> "$latency_file"
    done

    stats="$(docker stats --no-stream --format '{{.CPUPerc}}\t{{.MemUsage}}' "$container")"
    printf '%s\t%s\t%s\t%s\t%s\n' "$label" "$startup_ms" \
        "$(sort -n "$latency_file" | awk -v count="$REQUESTS" '
            function percentile(p) { position = int((count - 1) * p) + 1; return values[position] }
            { values[NR] = $1 * 1000 }
            END { printf "P50=%.3fms P95=%.3fms P99=%.3fms", percentile(0.50), percentile(0.95), percentile(0.99) }
        ')" "$stats" "$port" "$management_port"
}

docker network create "$NETWORK" >/dev/null
docker run -d --name "$POSTGRES_CONTAINER" --network "$NETWORK" --network-alias postgres \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=postgres -e POSTGRES_USER=postgres \
    postgres:18-alpine >/dev/null
until docker exec "$POSTGRES_CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; do
    sleep 0.2
done

JVM_BUILD="$(build_image jvm docker/Dockerfile.control-jvm "$JVM_IMAGE")"
NATIVE_BUILD="$(build_image native docker/Dockerfile.control-native "$NATIVE_IMAGE")"
JVM_RUN="$(run_workload JVM "$JVM_IMAGE" "$JVM_CONTAINER" "$JVM_PORT" "$MANAGEMENT_PORT")"
NATIVE_RUN="$(run_workload Native "$NATIVE_IMAGE" "$NATIVE_CONTAINER" "$NATIVE_PORT" "$NATIVE_MANAGEMENT_PORT")"

mkdir -p "$(dirname "$REPORT_PATH")"
{
    echo '# Control API JVM / Native POC benchmark'
    echo
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo
    echo '## Reproduction'
    echo
    echo 'From a clean checkout with Docker available:'
    echo
    echo '```bash'
    echo 'CONTROL_POC_REQUESTS=100 bash tools/control-native-benchmark.sh'
    echo '```'
    echo
    echo 'The script builds both images with `--no-cache`, starts the same Control API against a real PostgreSQL 18 container, waits for the independent management health endpoint, then sends the health workload. The health workload exercises Spring Boot Actuator and the JDBC-backed health indicator; the PR E integration test separately covers the protected `JdbcClient SELECT 1` endpoint and security roles.'
    echo
    echo 'PostgreSQL uses Docker-network-local trust authentication only. No production credentials or configuration are used.'
    echo
    echo '## Results'
    echo
    echo '| Variant | Build duration (ms) | Image size (bytes) | Startup after container launch (ms) | Latency | CPU / RSS sample | Ports |'
    echo '|---|---:|---:|---:|---|---|---|'
    for result in "$JVM_BUILD" "$NATIVE_BUILD"; do
        IFS=$'\t' read -r label duration size log_file <<< "$result"
        echo "| $label build | $duration | $size | — | — | — | — |"
    done
    for result in "$JVM_RUN" "$NATIVE_RUN"; do
        IFS=$'\t' read -r label startup latency stats port management_port <<< "$result"
        echo "| $label runtime | — | — | $startup | $latency | $stats | $port / $management_port |"
    done
    echo
    echo '## Disposition'
    echo
    echo '| Artifact | Disposition | Reason |'
    echo '|---|---|---|'
    echo '| `docker/Dockerfile.control-jvm` | KEEP | Reproducible JVM comparison build for the same Control API |'
    echo '| `docker/Dockerfile.control-native` | KEEP | Reproducible Native Image build foundation for a future Control API deployment |'
    echo '| `tools/control-native-benchmark.sh` | KEEP | Reproducible, benchmark-only DB-backed workload harness; not part of a production module |'
    echo '| Docker-network PostgreSQL container and trust-auth settings | REMOVE after each run | Ephemeral benchmark resources; never production configuration |'
    echo '| RabbitMQ/COS integration | DEFER | Explicitly outside this minimal Native POC |'
} > "$REPORT_PATH"
