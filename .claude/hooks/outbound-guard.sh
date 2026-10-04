#!/usr/bin/env bash
# Before a shell command or web fetch: the project's hard rules on what goes
# out and what comes in. No Google Street View imagery, no personal data in
# request headers, no secrets printed into the transcript.
input="$(cat)"
tool="$(jq -r '.tool_name // ""' <<<"$input")"
if [ "$tool" = "WebFetch" ]; then
  text="$(jq -r '.tool_input.url // ""' <<<"$input")"
else
  text="$(jq -r '.tool_input.command // ""' <<<"$input")"
fi

block() {
  echo "Blocked: $1" >&2
  exit 2
}

# Google Street View imagery is never allowed (licence), whatever the endpoint.
grep -qiE 'maps\.googleapis\.com/maps/api/streetview|streetviewpixels|cbk[0-9]?\.google|google\.[a-z.]+/maps/@[^ ]*!1s|geo[0-9]\.ggpht\.com' <<<"$text" \
  && block "Google Street View imagery is never used in this project (CLAUDE.md, Licences). Use CC0/CC-BY sources or our own photos."

if [ "$tool" != "WebFetch" ]; then
  # Personal data in request headers: an email address in a curl/wget header or user agent.
  if grep -qE '\b(curl|wget|http|xh)\b' <<<"$text" && grep -qE -- '(-A|--user-agent|-H|--header)[= ]+[^|;&]*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' <<<"$text"; then
    block "An email address in a request header or user agent. Never send personal data to outside services; use a generic user agent like 'RealWorld-research/0.1'."
  fi
  # Secrets stay in environment variables; never print them into the transcript.
  if grep -qE '\b(echo|printf|cat|printenv)\b[^|;&]*\$\{?[A-Z_]*(TOKEN|SECRET|API_KEY|PASSWORD)' <<<"$text" || grep -qE '\bprintenv\b[^|;&]*(TOKEN|SECRET|API_KEY|PASSWORD)|^\s*(env|printenv)\s*$' <<<"$text"; then
    block "That would print a secret into the conversation. Pass it to the program that needs it (e.g. \"\$MAPILLARY_TOKEN\" as an argument or env), never echo it. To check it's set: [ -n \"\$MAPILLARY_TOKEN\" ] && echo set."
  fi
fi
exit 0
