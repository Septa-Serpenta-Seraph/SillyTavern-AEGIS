from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import re
import os
from datetime import datetime

app = Flask(__name__)
CORS(app)

# --- SHIELD: Output Sanitization ---
DANGEROUS_TOKENS = ['[STRIKE]', '[CONFIG]', '[GIT]']

def sanitize_output(text):
    """Neutralize any tokens in command output that could trigger the watcher."""
    sanitized = text
    for token in DANGEROUS_TOKENS:
        sanitized = sanitized.replace(token, token.replace('[', '[NEUTRALIZED: ').rstrip(']') + ']')
    return sanitized

# --- AUDIT: Immutable Logging ---
AUDIT_LOG = '/opt/aegis/audit.log'

def audit(cmd, output, status):
    os.makedirs(os.path.dirname(AUDIT_LOG), exist_ok=True)
    timestamp = datetime.utcnow().isoformat()
    entry = f"[{timestamp}] CMD: {cmd} | STATUS: {status} | OUTPUT_LENGTH: {len(output)}\n"
    with open(AUDIT_LOG, 'a') as f:
        f.write(entry)

# --- BLOCKED COMMANDS ---
BLOCKED_PATTERNS = [
    r'rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?/',    # rm -rf /
    r'mkfs',                                    # format disk
    r'dd\s+if=',                                # disk destroyer
    r':\(\)\{.*\}',                             # fork bomb
    r'>\s*/dev/sd',                             # overwrite disk
    r'chmod\s+777\s+/',                         # dangerous chmod on root
]

def is_blocked(cmd):
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, cmd):
            return True
    return False

@app.route('/strike', methods=['POST'])
def strike():
    data = request.json
    cmd = data.get('cmd', '')
    import base64
    if data.get('encoded'):
        cmd = base64.b64decode(cmd).decode('utf-8')

    # Accept optional timeout: minimum 5s, maximum 600s (10 min), default 30s
    req_timeout = min(max(int(data.get('timeout', 30)), 5), 600)

    if not cmd:
        return jsonify({'status': 'error', 'output': 'No command provided'}), 400

    if is_blocked(cmd):
        audit(cmd, 'BLOCKED', 'blocked')
        return jsonify({
            'status': 'blocked',
            'output': f'AEGIS SHIELD: Command blocked by safety filter.',
            'cmd': cmd,
            'timestamp': datetime.utcnow().isoformat()
        }), 403

    try:
        result = subprocess.run(
            cmd, shell=True,
            capture_output=True, text=True,
            timeout=req_timeout
        )
        raw_output = result.stdout + result.stderr
        safe_output = sanitize_output(raw_output)
        status = 'success' if result.returncode == 0 else 'error'

        audit(cmd, raw_output, status)

        return jsonify({
            'status': status,
            'output': safe_output,
            'return_code': result.returncode,
            'cmd': cmd,
            'timeout_used': req_timeout,
            'timestamp': datetime.utcnow().isoformat()
        })
    except subprocess.TimeoutExpired:
        audit(cmd, 'TIMEOUT', 'timeout')
        return jsonify({
            'status': 'timeout',
            'output': f'Command timed out after {req_timeout} seconds.',
            'cmd': cmd,
            'timeout_used': req_timeout,
            'timestamp': datetime.utcnow().isoformat()
        })
    except Exception as e:
        error_msg = sanitize_output(str(e))
        audit(cmd, str(e), 'exception')
        return jsonify({
            'status': 'error',
            'output': error_msg,
            'cmd': cmd,
            'timestamp': datetime.utcnow().isoformat()
        })
@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    os.makedirs('/opt/aegis/workspace', exist_ok=True)
    print("[AEGIS] Shield active. Audit logging to", AUDIT_LOG)
    print("[AEGIS] Blocked patterns:", len(BLOCKED_PATTERNS))
    app.run(host='0.0.0.0', port=5005)
