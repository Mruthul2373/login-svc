/**
 * observability.js
 * Prometheus metrics + /health + /metrics endpoints.
 *
 * This file is intentionally DUPLICATED into each service rather than shared
 * via a common npm package. That is deliberate: each microservice must be
 * independently buildable and deployable with no shared build-time dependency.
 * Duplicating ~50 lines is the correct trade here.
 */
const os = require('os');
const client = require('prom-client');

function setupObservability(app, serviceName) {
  const register = new client.Registry();

  // Every metric is stamped with service="<name>" so Grafana can
  // group with:  sum(rate(http_requests_total[1m])) by (service)
  register.setDefaultLabels({ service: serviceName });

  // Node process metrics: CPU, heap, event-loop lag, GC, open handles.
  client.collectDefaultMetrics({ register });

  const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register],
  });

  const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    // Buckets chosen for a fast JSON API. histogram_quantile(0.95, ...)
    // in Grafana interpolates between these.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  const httpInFlight = new client.Gauge({
    name: 'http_requests_in_flight',
    help: 'Number of HTTP requests currently being served',
    registers: [register],
  });

  app.use((req, res, next) => {
    // Skip /metrics itself so Prometheus scraping does not inflate its own numbers.
    if (req.path === '/metrics') return next();

    httpInFlight.inc();
    const stopTimer = httpRequestDuration.startTimer();

    res.on('finish', () => {
      // req.route?.path collapses /payment/tx/123 -> /payment/tx/:id, which
      // prevents unbounded label cardinality (a classic Prometheus outage).
      // Express reports an array path (e.g. ['/', '/test']) as the raw array,
      // which stringifies to "/,/test" and creates a junk Grafana series.
      // Normalise to the first (canonical) path.
      let route = (req.route && req.route.path) || req.path;
      if (Array.isArray(route)) route = route[0];
      const labels = {
        method: req.method,
        route,
        status: String(res.statusCode),
      };
      httpRequestsTotal.inc(labels);
      stopTimer(labels);
      httpInFlight.dec();
    });

    next();
  });

  // ALB target-group health check hits this. Must be cheap and dependency-free.
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: serviceName,
      host: os.hostname(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // Prometheus scrapes this via Cloud Map DNS service discovery.
  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.send(await register.metrics());
    } catch (err) {
      res.status(500).send(err.message);
    }
  });

  return { register, httpRequestsTotal, httpRequestDuration };
}

module.exports = { setupObservability };

