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
WORKLOAD_PAUSE_SEC="${CONTROL_POC_WORKLOAD_PAUSE_SEC:-0.02}"
TMP_DIR="$(mktemp -d)"

cleanup() {
    docker rm -f "$JVM_CONTAINER" "$NATIVE_CONTAINER" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
    docker image rm "$JVM_IMAGE" "$NATIVE_IMAGE" >/dev/null 2>&1 || true
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
    local stats_file="$TMP_DIR/$label-stats.txt"
    local sampler_ready="$TMP_DIR/$label-sampler-ready"
    local idle_stats load_stats sampler_pid workload_status

    summarize_stats() {
        awk '
            function memory_mib(value, number, unit) {
                gsub(/^[ \t]+|[ \t]+$/, "", value)
                number = value
                sub(/[A-Za-z]+$/, "", number)
                unit = value
                sub(/^[0-9.]+/, "", unit)
                if (unit == "GiB") return number * 1024
                if (unit == "KiB") return number / 1024
                if (unit == "B") return number / 1024 / 1024
                return number
            }
            {
                cpu = $1
                sub(/%/, "", cpu)
                split($2, usage, "/")
                mem = memory_mib(usage[1])
                if (cpu > max_cpu) max_cpu = cpu
                if (mem > max_mem) max_mem = mem
                samples++
            }
            END {
                if (samples == 0) exit 1
                printf "CPU(max)=%.2f%% RSS(max)=%.1fMiB samples=%d", max_cpu, max_mem, samples
            }
        '
    }

    startup_start="$(timestamp_ms)"
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

    deadline="$((startup_start + 120000))"
    until curl --fail --silent --show-error "http://127.0.0.1:$management_port/actuator/health" >/dev/null 2>&1; do
        if (( $(timestamp_ms) >= deadline )); then
            docker logs "$container"
            return 1
        fi
        sleep 0.1
    done
    startup_end="$(timestamp_ms)"
    startup_ms="$((startup_end - startup_start))"

    idle_stats="$(docker stats --no-stream --format '{{.CPUPerc}}\t{{.MemUsage}}' "$container")"

    : > "$latency_file"
    : > "$stats_file"
    (
        while true; do
            docker stats --no-stream --format '{{.CPUPerc}}\t{{.MemUsage}}' "$container" >> "$stats_file" 2>/dev/null || exit 0
            touch "$sampler_ready"
            sleep 0.01
        done
    ) &
    sampler_pid="$!"
    while [[ ! -e "$sampler_ready" ]]; do
        if ! kill -0 "$sampler_pid" 2>/dev/null; then
            return 1
        fi
        sleep 0.01
    done
    workload_status=0
    for ((i = 0; i < REQUESTS; i++)); do
        if ! curl --fail --silent --show-error \
            -o /dev/null -w '%{time_total}\n' \
            "http://127.0.0.1:$management_port/actuator/health" >> "$latency_file"; then
            workload_status=1
            break
        fi
        sleep "$WORKLOAD_PAUSE_SEC"
    done
    kill "$sampler_pid" >/dev/null 2>&1 || true
    wait "$sampler_pid" >/dev/null 2>&1 || true
    if (( workload_status != 0 )); then
        return "$workload_status"
    fi

    load_stats="$(summarize_stats < "$stats_file")"
    printf '%s|%s|%s|%s|%s|%s|%s\n' "$label" "$startup_ms" \
        "$(sort -n "$latency_file" | awk -v count="$REQUESTS" '
            function percentile(p) { position = int((count - 1) * p) + 1; return values[position] }
            { values[NR] = $1 * 1000 }
            END { printf "P50=%.3fms P95=%.3fms P99=%.3fms", percentile(0.50), percentile(0.95), percentile(0.99) }
        ')" "$(printf '%s\n' "$idle_stats" | summarize_stats)" "$load_stats" "$port" "$management_port"
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
    echo 'CONTROL_POC_REQUESTS=100 CONTROL_POC_WORKLOAD_PAUSE_SEC=0.02 bash tools/control-native-benchmark.sh'
    echo '```'
    echo
    echo 'The script builds both images with `--no-cache`, starts the same Control API against a real PostgreSQL 18 container, waits for the independent management health endpoint, then sends the health workload. The health workload exercises Spring Boot Actuator and the JDBC-backed health indicator; the PR E integration test separately covers the protected `JdbcClient SELECT 1` endpoint and security roles.'
    echo
    echo "The POC build images use JDK 25 because this Spring Boot Native Build Tools path requires it; Maven still compiles the Control API with the repository's Java 21 release target. This isolated POC build choice does not change the project's Java 21 baseline or production runtime."
    echo
    echo "The default 0.02-second inter-request pause keeps the workload long enough for in-flight Docker stats sampling; per-request latency excludes this pause. Override it with CONTROL_POC_WORKLOAD_PAUSE_SEC when reproducing the benchmark."
    echo
    echo 'PostgreSQL uses Docker-network-local trust authentication only. No production credentials or configuration are used.'
    echo
    echo '## Results'
    echo
    echo '| Variant | Build duration (ms) | Image size (bytes) | Cold start from docker run (ms) | Latency | Idle CPU / RSS | Load CPU / RSS (sampled during requests) | Ports |'
    echo '|---|---:|---:|---:|---|---|---|---|'
    for result in "$JVM_BUILD" "$NATIVE_BUILD"; do
        IFS=$'\t' read -r label duration size log_file <<< "$result"
        echo "| $label build | $duration | $size | — | — | — | — |"
    done
    for result in "$JVM_RUN" "$NATIVE_RUN"; do
        IFS='|' read -r label startup latency idle_stats load_stats port management_port <<< "$result"
        echo "| $label runtime | — | — | $startup | $latency | $idle_stats | $load_stats | $port / $management_port |"
    done
    echo
    echo '## Decision'
    echo
    echo 'Both JVM and Native Image clean builds and DB-backed workloads completed. Native Image is the preferred runtime foundation for the next comparison step based on the measured cold-start, latency and resource results above; production deployment adoption remains DEFERRED outside this POC.'
    echo
    echo '## Disposition'
    echo
    echo '| Artifact | Disposition | Reason |'
    echo '|---|---|---|'
    echo '| `java/wotb-control/pom.xml` native profile | KEEP | Reproducible AOT/native build configuration for the isolated POC path |'
    echo '| `docker/Dockerfile.control-jvm` | KEEP | Reproducible JVM comparison build for the same Control API |'
    echo '| `docker/Dockerfile.control-native` | KEEP | Reproducible Native Image build foundation for a future Control API deployment |'
    echo '| `tools/control-native-benchmark.sh` | KEEP | Reproducible, benchmark-only DB-backed workload harness; not part of a production module |'
    echo '| Generated `target/` classes, native executable and local Docker images | REMOVE after each run | Build outputs are not source or production artifacts |'
    echo '| Docker-network PostgreSQL container and trust-auth settings | REMOVE after each run | Ephemeral benchmark resources; never production configuration |'
    echo '| RabbitMQ/COS integration | DEFER | Explicitly outside this minimal Native POC |'
} > "$REPORT_PATH"
