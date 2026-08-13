# Deploy to IBM Cloud Code Engine

## Why Code Engine?
IBM Cloud Code Engine is a fully managed serverless container platform.
Push your Docker image → Code Engine handles HTTPS, autoscaling (including
scale-to-zero when idle), and load balancing. No infrastructure to manage.

## Prerequisites
- IBM Cloud CLI: https://cloud.ibm.com/docs/cli
- Code Engine plugin: `ibmcloud plugin install code-engine`
- IBM Container Registry access on your IBM Cloud account

## Steps

### 1. Log in to IBM Cloud
```bash
ibmcloud login
ibmcloud cr login
```

### 2. Build and push the Docker image
```bash
# Tag format: <region>.icr.io/<namespace>/<image>:<tag>
docker build -t ca-tor.icr.io/hybrid-training/ibm-fitness:latest .
docker push ca-tor.icr.io/hybrid-training/ibm-fitness:latest
```

### 3. Create a Code Engine project (first time only)
```bash
ibmcloud ce project create --name hybrid-training-ibm
ibmcloud ce project select --name hybrid-training-ibm
```

### 4. Deploy the app
```bash
ibmcloud ce app create \
  --name ibm-fitness \
  --image ca-tor.icr.io/hybrid-training/ibm-fitness:latest \
  --port 3000 \
  --min-scale 0 \
  --max-scale 3 \
  --env WATSONX_API_KEY=<your-key> \
  --env WATSONX_SPACE_ID=06784f88-38b7-440d-a936-f947f6ad5c01 \
  --env WATSONX_URL=https://ca-tor.ml.cloud.ibm.com \
  --env NEXT_PUBLIC_SUPABASE_URL=<your-url> \
  --env NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-key>
```

### 5. Get the live URL
```bash
ibmcloud ce app get --name ibm-fitness --output url
```

## Update a deployment
```bash
docker build -t ca-tor.icr.io/hybrid-training/ibm-fitness:latest .
docker push ca-tor.icr.io/hybrid-training/ibm-fitness:latest
ibmcloud ce app update --name ibm-fitness --image ca-tor.icr.io/hybrid-training/ibm-fitness:latest
```

## Interview talking point
"I containerised the app with Docker and deployed it to IBM Cloud Code Engine.
Code Engine is serverless — it scales to zero when there's no traffic (cost efficient)
and auto-scales under load. The same IBM IAM credentials that authenticate my app
to WatsonX.ai also control access to Code Engine and the Container Registry —
one unified identity layer across the entire IBM Cloud stack."
