"""Read-only GitHub REST client; exception text never includes upstream bodies."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request


class GitHubError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class GitHubClient:
    def __init__(self, token_file, opener=None, sleep=time.sleep, clock=time.time):
        self.token_file = token_file
        self.opener = opener or urllib.request.build_opener(NoRedirect()).open
        self.sleep, self.clock = sleep, clock
        self.remaining = -1
        self.reset = 0
        self.errors = 0

    def _rate(self, headers):
        self.remaining = int(headers.get('X-RateLimit-Remaining', self.remaining))
        self.reset = int(headers.get('X-RateLimit-Reset', self.reset))

    def get(self, path):
        # Reject foreign pagination links before sending credentials.
        url = urllib.parse.urljoin('https://api.github.com/', path)
        if urllib.parse.urlsplit(url).netloc != 'api.github.com' or not url.startswith('https://api.github.com/'):
            raise GitHubError('invalid API origin')
        if 0 <= self.remaining < 20 and self.reset > self.clock():
            raise GitHubError('rate limit reserve')
        try:
            with open(self.token_file, encoding='utf-8') as source:
                token = source.read().strip()
            if not token:
                raise GitHubError('token unavailable')
        except OSError:
            raise GitHubError('token unavailable') from None
        request = urllib.request.Request(url, headers={
            'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'wotb-dev-metrics-v1',
        }, method='GET')
        for attempt in range(3):
            try:
                with self.opener(request, timeout=30) as response:
                    self._rate(response.headers)
                    return json.load(response), response.headers.get('Link', '')
            except urllib.error.HTTPError as error:
                self.errors += 1
                self._rate(error.headers)
                status = error.code
                error.close()
                if status != 429 and status < 500:
                    raise GitHubError('GitHub HTTP ' + str(status)) from None
                if attempt == 2 or (0 <= self.remaining < 20 and self.reset > self.clock()):
                    raise GitHubError('GitHub HTTP ' + str(status)) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                self.errors += 1
                if attempt == 2:
                    raise GitHubError('GitHub connection failed') from None
            except (ValueError, TypeError):
                self.errors += 1
                raise GitHubError('invalid GitHub response') from None
            self.sleep(2 ** attempt)
        raise GitHubError('GitHub request failed')

    def pages(self, path, key=None):
        seen = set()
        while path:
            if path in seen:
                raise GitHubError('pagination cycle')
            seen.add(path)
            body, link = self.get(path)
            items = body[key] if key else body
            if not isinstance(items, list):
                raise GitHubError('invalid GitHub collection')
            yield from items
            path = None
            for part in link.split(','):
                if 'rel="next"' in part:
                    path = part.split('<', 1)[1].split('>', 1)[0]
                    break
