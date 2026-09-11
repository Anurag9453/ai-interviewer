# EC2 deployment runbook — voice-agent worker

Execute from your own Mac with your own AWS identity. Nothing here has been
run; every result below is something **you** produce and paste back.

**Target:** `t4g.small` (ARM64 Graviton) · Amazon Linux 2023 ARM64 ·
`ap-southeast-1` · 20 GB gp3 · public IP · **zero inbound rules** ·
SSM Session Manager for access · CloudWatch logs · systemd-managed.

**Never paste back:** parameter *values*, the contents of
`/run/voice-agent.env`, the deploy **private** key, or your AWS keys. Every
"paste back" item below is deliberately non-secret.

---

## Prerequisites

```bash
aws --version                 # v2 required; brew install awscli
export AWS_REGION=ap-southeast-1
aws sts get-caller-identity   # paste back: Account + Arn (no secrets)
```

Your **operator** identity needs `ec2:*` (describe/create/run/terminate),
`iam:CreateRole`/`PutRolePolicy`/`CreateInstanceProfile`/`AddRoleToInstanceProfile`,
`iam:PassRole`, `ssm:PutParameter`, `ssm:StartSession`, `logs:CreateLogGroup`.
**Not** `AdministratorAccess`.

### Why `iam:PassRole` is needed on YOU, not the instance

Launching an instance with an instance profile means *handing* a role to EC2.
AWS treats that as a privilege escalation vector, so your own identity needs
`iam:PassRole` for that specific role — otherwise anyone who can launch an
instance could attach an admin role to it. This is separate from, and in
addition to, the instance role's own permissions. Scope it tightly:

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "arn:aws:iam::ACCOUNT_ID:role/ai-interviewer-voice-agent",
  "Condition": { "StringEquals": { "iam:PassedToService": "ec2.amazonaws.com" } }
}
```

---

## Step 1 — Discover VPC, subnet, AMI

No hardcoded IDs. Each value is discovered and echoed so you can verify it.

```bash
export AWS_REGION=ap-southeast-1

# Default VPC (do NOT assume one exists — this fails loudly if not)
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
echo "VPC_ID=$VPC_ID"     # "None" => no default VPC; pick one explicitly:
# aws ec2 describe-vpcs --query 'Vpcs[].{Id:VpcId,Cidr:CidrBlock,Default:IsDefault}' --output table

# A subnet that auto-assigns public IPs (needed for OUTBOUND only — there is
# no NAT gateway, so the instance reaches the internet via the IGW directly)
aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID \
  --query 'Subnets[].{Id:SubnetId,AZ:AvailabilityZone,PublicIP:MapPublicIpOnLaunch,Cidr:CidrBlock}' \
  --output table
SUBNET_ID=<pick one with PublicIP=True>
echo "SUBNET_ID=$SUBNET_ID"

# AL2023 ARM64 AMI, resolved from the AWS-published SSM parameter rather
# than a copied AMI ID (which would be stale and region-specific)
AMI_ID=$(aws ssm get-parameter \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --query Parameter.Value --output text)
echo "AMI_ID=$AMI_ID"
```

**Paste back:** `VPC_ID`, `SUBNET_ID`, `AMI_ID`, and the subnet table.

---

## Step 2 — IAM role and instance profile

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# The AWS-managed key SSM uses by default; needed for the kms:Decrypt ARN
KMS_KEY_ID=$(aws kms describe-key --key-id alias/aws/ssm \
  --query 'KeyMetadata.KeyId' --output text)
echo "KMS_KEY_ID=$KMS_KEY_ID"

cd deploy/aws
sed -e "s/ACCOUNT_ID/$ACCOUNT_ID/g" -e "s/KMS_KEY_ID/$KMS_KEY_ID/g" \
  iam-instance-policy.json > /tmp/iam-instance-policy.json

aws iam create-role \
  --role-name ai-interviewer-voice-agent \
  --assume-role-policy-document file://iam-trust-policy.json \
  --description "voice-agent worker: SSM session, read its own SSM params, write its own log group"

# Session Manager. This managed policy is what removes the need for SSH,
# and therefore the need for ANY inbound security-group rule.
aws iam attach-role-policy \
  --role-name ai-interviewer-voice-agent \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

aws iam put-role-policy \
  --role-name ai-interviewer-voice-agent \
  --policy-name voice-agent-secrets-and-logs \
  --policy-document file:///tmp/iam-instance-policy.json

aws iam create-instance-profile --instance-profile-name ai-interviewer-voice-agent
aws iam add-role-to-instance-profile \
  --instance-profile-name ai-interviewer-voice-agent \
  --role-name ai-interviewer-voice-agent
```

**Paste back:** the role ARN, and
`aws iam list-attached-role-policies --role-name ai-interviewer-voice-agent`.

> Instance-profile propagation is eventually consistent. If step 4 reports an
> invalid profile, wait ~10s and retry — not a misconfiguration.

---

## Step 3 — Security group with ZERO inbound

```bash
SG_ID=$(aws ec2 create-security-group \
  --group-name ai-interviewer-voice-agent \
  --description "voice-agent worker: outbound only, no inbound" \
  --vpc-id $VPC_ID --query GroupId --output text)
echo "SG_ID=$SG_ID"
```

`create-security-group` adds **no** inbound rules and a default
allow-all **egress** rule. That is exactly what we want, so **do not add any
ingress**. Verify it is genuinely empty:

```bash
aws ec2 describe-security-groups --group-ids $SG_ID \
  --query 'SecurityGroups[0].{In:IpPermissions,Out:IpPermissionsEgress}'
```

Expected: `In` is `[]`. Egress must stay open — the worker needs outbound
443 (LiveKit signalling, Deepgram, Cartesia, Anthropic, SSM), TCP 6543
(Supabase pooler) and **UDP for WebRTC media**. Restricting egress to TCP 443
would force TURN/TCP relay and audibly degrade audio.

**Paste back:** `SG_ID` and that query's output (proof `In: []`).

---

## Step 4 — Launch the instance

```bash
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t4g.small \
  --subnet-id $SUBNET_ID \
  --security-group-ids $SG_ID \
  --iam-instance-profile Name=ai-interviewer-voice-agent \
  --associate-public-ip-address \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":20,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]' \
  --metadata-options 'HttpTokens=required' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ai-interviewer-voice-agent},{Key=Project,Value=ai-interviewer},{Key=Env,Value=beta}]' \
  --query 'Instances[0].InstanceId' --output text)
echo "INSTANCE_ID=$INSTANCE_ID"

aws ec2 wait instance-status-ok --instance-ids $INSTANCE_ID
aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].{Id:InstanceId,Type:InstanceType,Arch:Architecture,State:State.Name,AZ:Placement.AvailabilityZone,PublicIp:PublicIpAddress}'
```

No key pair is specified — access is via Session Manager, so there is no SSH
key to manage or leak. `HttpTokens=required` enforces IMDSv2.

**Paste back:** `INSTANCE_ID` and that description (`Arch` must be `arm64`).

---

## Step 5 — Populate SSM parameters

```bash
cp deploy/aws/create-ssm-parameters.sh ~/ssm-params.sh
# Edit ~/ssm-params.sh, replacing each REPLACE_ME with the real value.
chmod 700 ~/ssm-params.sh && ~/ssm-params.sh
rm -P ~/ssm-params.sh          # shred your filled-in copy

# NAMES only — this prints no values
aws ssm get-parameters-by-path --path /ai-interviewer/voice \
  --query 'Parameters[].Name' --output table
```

**Paste back:** the names table. **Never** the values.

---

## Step 6 — Connect via Session Manager

```bash
aws ssm start-session --target $INSTANCE_ID
```

If this fails, the instance hasn't registered with SSM yet (give it a minute)
or the role/profile didn't attach. Check:
`aws ssm describe-instance-information --query "InstanceInformationList[?InstanceId=='$INSTANCE_ID']"`

**Paste back:** confirmation that the session opens (no secrets).

---

## Step 7 — Bootstrap and build

In the session:

```bash
sudo dnf install -y git
sudo git clone https://github.com/Anurag9453/ai-interviewer.git /tmp/boot 2>/dev/null \
  || echo "expected to fail: the repo is PRIVATE"
```

That failure is expected and is why bootstrap generates a deploy key. Get the
script onto the box (it's small — paste it, or fetch it after the key exists):

```bash
sudo bash /opt/ai-interviewer/deploy/aws/bootstrap.sh   # if already cloned
# otherwise paste deploy/aws/bootstrap.sh into /root/bootstrap.sh and:
#   sudo bash /root/bootstrap.sh
```

It installs Docker/git/jq, creates 2 GB swap, prints a **public** deploy key
for you to add to GitHub (read-only, "Allow write access" unchecked), clones,
creates the log group, and builds the image.

Watch for, in the build output:
- `Scope: 2 of 5 workspace projects`
- `Lockfile is up to date, resolution step is skipped`
- `onnxruntime-node postinstall` → **Done**
- `@livekit/local-inference install` → **Done**

Then:

```bash
docker image inspect voice-agent:test --format 'size={{.Size}} arch={{.Os}}/{{.Architecture}}'
free -m ; nproc          # memory/CPU observed after build
```

**Paste back:** the last ~30 lines of build output, the image size/arch line,
and `free -m`. **Arch must be `linux/arm64`.**

> If the build is OOM-killed: **stop and paste the evidence** (`dmesg | grep -i
> -E 'killed process|out of memory'`). Do not resize on your own — we agreed to
> report before changing instance size.

---

## Step 8 — SIGTERM / drain test (the gate that matters)

Run the container manually first, with **representative** config, so a signal
problem is found before systemd is involved.

```bash
sudo /usr/local/bin/fetch-secrets.sh    # prints NAMES only
sudo docker run -d --name voice-agent --init \
  --env-file /run/voice-agent.env \
  -e PORT=8080 -e AI_PROVIDER=anthropic \
  voice-agent:test

sleep 25
sudo docker logs voice-agent | tail -40          # paste this back
sudo docker exec voice-agent ps -ef              # paste this back — process chain

# Local-only health check; never published to the host or internet
sudo docker exec voice-agent sh -c 'command -v curl >/dev/null && curl -s localhost:8080/health || echo "(no curl in image)"'
```

`ps -ef` tells us the signal path in advance. Expect
`pnpm → tsx → node` under tini (PID 1). **Three hops, each of which must
forward SIGTERM.**

Now the actual test:

```bash
time sudo docker stop --time=960 voice-agent
sudo docker logs voice-agent 2>&1 | tail -40     # paste this back
sudo docker ps -a | grep voice-agent || echo "no zombie container"
```

**PASS** — `docker stop` returns in a second or two (not ~960s), logs show
LiveKit draining/shutting down, and the container exits cleanly.

**FAIL** — `docker stop` hangs for the full 960s then the container dies by
SIGKILL, with no drain lines. That means a hop swallowed the signal.

### If it FAILS — the prepared minimal fix

Do **not** redesign anything. The smallest change is to make the Node process
PID 1 directly, eliminating the pnpm and tsx hops. Replace the last two lines
of `apps/voice-agent/Dockerfile`:

```dockerfile
WORKDIR /app/apps/voice-agent
CMD ["node", "--import", "tsx", "src/worker.ts", "start"]
```

This is byte-for-byte the same program `pnpm start:worker` runs — `tsx`'s
documented single-process invocation, registering its ESM loader in-process
instead of spawning a child. No application code changes. Rebuild and retest
step 8. **Send me the failing evidence before applying it** so the fix is
justified by the logs, not by assumption.

---

## Step 9–10 — Install and start the service

Only after step 8 passes:

```bash
sudo docker tag voice-agent:test voice-agent:current
sudo systemctl enable --now voice-agent
sleep 20
systemctl status voice-agent --no-pager        # paste back
```

`enable` gives start-on-boot; `Restart=always` gives crash recovery.

---

## Step 11 — Verify LiveKit registration (the key acceptance signal)

EC2 `running`, Docker `Up`, systemd `active`, and `/health` returning 200 are
**none of them** evidence the worker registered. A process can sit up forever
accepting no jobs — exactly the failure the old Dockerfile CMD would have
produced.

```bash
sudo docker logs voice-agent 2>&1 | grep -iE "registered|worker|livekit|available" | tail -20
aws logs tail /ai-interviewer/voice-agent --since 10m --region ap-southeast-1
```

Look for an explicit **worker registered / registered worker** line naming a
worker id or the LiveKit URL. `service: "voice-agent-worker"` in the health
payload confirms the *real* pipeline is running (not the health-only process),
but registration is the acceptance signal.

**Paste back:** the matching log lines, and confirmation the same lines appear
in CloudWatch (proves the awslogs driver works).

---

## Step 12 — Stability

```bash
sleep 600
systemctl status voice-agent --no-pager | head -12
sudo systemctl show voice-agent -p NRestarts      # must stay 0
free -m ; top -bn1 | head -12                     # runtime memory/CPU
aws logs tail /ai-interviewer/voice-agent --since 15m --region ap-southeast-1 | tail -30
```

Also prove reboot recovery:

```bash
sudo reboot        # session drops; reconnect after ~60s
systemctl is-enabled voice-agent && systemctl is-active voice-agent
sudo docker logs voice-agent 2>&1 | grep -iE "registered" | tail -5
```

**Paste back:** `NRestarts` (expect 0), `free -m`, and post-reboot
registration lines.

---

## Cost, credits and not leaving it running

Estimates for `ap-southeast-1`, on-demand, **before credits** — verify in the
AWS Pricing Calculator:

| Item | ~Monthly |
|---|---|
| `t4g.small`, 730 h | **~$15–17** |
| 20 GB gp3 (encrypted) | ~$2 |
| CloudWatch Logs (30-day retention, low volume) | <$1 |
| Data transfer out | ~$0 (first 100 GB free; beta audio egress is small) |
| SSM Parameter Store (standard) | $0 |
| **Total** | **~$18–20/mo** |

**Credits** apply automatically against the monthly bill at invoicing; they do
not change the displayed on-demand rates, so the console will show charges
that your credit balance then offsets. Nothing to configure.

**Avoid leaving it running unused:**

```bash
# Stop (keeps the EBS volume and its ~$2/mo; compute stops billing)
aws ec2 stop-instances --instance-ids $INSTANCE_ID

# Budget alarm — do this once, it is the real safety net
aws budgets create-budget --account-id $ACCOUNT_ID --budget \
  '{"BudgetName":"ai-interviewer-beta","BudgetLimit":{"Amount":"30","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}'
```

Set a calendar reminder too. A forgotten `t4g.small` is ~$16/month forever.

---

## Rollback

```bash
# 1. Image rollback — seconds, no rebuild. Tag before every new build:
sudo docker tag voice-agent:current voice-agent:previous
# ...then to roll back:
sudo systemctl stop voice-agent
sudo docker tag voice-agent:previous voice-agent:current
sudo systemctl start voice-agent

# 2. Service rollback
sudo systemctl restart voice-agent        # or: stop, to halt cleanly
sudo systemctl disable voice-agent        # stop starting on boot

# 3. Instance termination (destroys the EBS volume: DeleteOnTermination=true)
aws ec2 terminate-instances --instance-ids $INSTANCE_ID
aws ec2 delete-security-group --group-id $SG_ID
aws iam remove-role-from-instance-profile \
  --instance-profile-name ai-interviewer-voice-agent --role-name ai-interviewer-voice-agent
aws iam delete-instance-profile --instance-profile-name ai-interviewer-voice-agent
aws iam delete-role-policy --role-name ai-interviewer-voice-agent --policy-name voice-agent-secrets-and-logs
aws iam detach-role-policy --role-name ai-interviewer-voice-agent \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam delete-role --role-name ai-interviewer-voice-agent
```

**The application stays cloud-agnostic.** No AWS SDK, no AWS env var, and no
`FLY_*`/Render reference exists in `apps/voice-agent/src` or
`packages/core/src`. Every AWS-specific piece lives in `deploy/aws/` — the
systemd unit, the secret-fetch script and the IAM policies. `render.yaml` and
`fly.toml` are untouched, so either remains a credentials-and-dashboard
exercise rather than a code change.

---

## Logging hygiene

The awslogs driver ships container stdout/stderr to CloudWatch, so logs
survive container restarts and instance reboots, with 30-day retention.

Audited previously and still true: every structured log line is counts, ids
and latencies. **No API keys, no secrets, no database passwords, no resume
contents and no candidate transcripts are logged** — `turn-metrics.ts` emits
only timings, and the document routes log document ids plus counts. The one
thing to keep in mind: `fetch-secrets.sh` prints parameter **names** only, and
`/run/voice-agent.env` is `0600 root:root` on tmpfs — never log its contents.
