# Firebase Cloud Functions - NEON REBOUND

This directory contains Firebase Cloud Functions for secure server-side score validation.

## Functions

### `submitScore` (Callable)
**Purpose**: Secure score submission with server-side validation

**Called from client**:
```javascript
const submitScoreFunction = httpsCallable(functions, 'submitScore');
const result = await submitScoreFunction({
    name: "PlayerName",
    score: 150,
    seed: "MISSION_1"
});
```

**Validation**:
- Authentication required (Firebase Auth)
- Name: 1-20 characters, alphanumeric + spaces/hyphens/underscores
- Score: 10-100,000 range
- Seed: 1-50 characters, alphanumeric + hyphens/underscores
- Rate limiting: 5 seconds between submissions per user

**Returns**:
```javascript
{
    success: true,
    scoreId: "-NxXxXxXxXxXxXxX",
    message: "Score submitted successfully"
}
```

### `health` (HTTP)
**Purpose**: Health check endpoint

**URL**: `https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/health`

**Returns**:
```json
{
    "status": "healthy",
    "timestamp": 1709596800000,
    "service": "NEON REBOUND Cloud Functions",
    "version": "1.0.0"
}
```

## Development

### Install Dependencies
```bash
npm install
```

### Deploy
```bash
firebase deploy --only functions
```

### View Logs
```bash
npm run logs
# or
firebase functions:log
```

### Test Locally (Optional)
```bash
npm run serve
# or
firebase emulators:start --only functions
```

## Configuration

### Environment Variables (if needed)
```bash
firebase functions:config:set service.url="https://example.com"
firebase functions:config:get
```

### Security Rules
Functions run with admin privileges and bypass security rules.  
Client access is restricted by Firebase Security Rules.

## Monitoring

### Firebase Console
1. Go to Firebase Console → Functions
2. View invocations, errors, and logs
3. Monitor usage and costs

### Command Line
```bash
# View logs
firebase functions:log

# View specific function logs
firebase functions:log --only submitScore

# List all functions
firebase functions:list
```

## Cost

### Free Tier
- 2M invocations/month
- 400,000 GB-seconds/month
- 200,000 CPU-seconds/month

### Typical Usage
- Score submission: ~1 invocation per game
- 1000 players/day: ~30,000 invocations/month
- **Cost: $0** (well within free tier)

## Troubleshooting

### Function Not Found
```bash
firebase deploy --only functions
```

### Permission Denied
Check that security rules are deployed:
```bash
firebase deploy --only database
```

### Cold Start Latency
- First invocation after 15+ minutes: 2-3 seconds
- Subsequent invocations: <300ms
- This is normal for serverless functions

## Security

### What's Protected
- ✅ All score submissions validated server-side
- ✅ Rate limiting enforced at database level
- ✅ Input validation cannot be bypassed
- ✅ Server timestamps prevent replay attacks

### Admin Privileges
Functions run with Firebase Admin SDK, which has full database access.  
All validation MUST happen in function code.

## Documentation

See project root for complete documentation:
- `CLOUD-FUNCTIONS-SETUP.md` - Setup guide
- `CLOUD-FUNCTIONS-IMPLEMENTATION.md` - Implementation details
- `CLOUD-FUNCTIONS-TESTING.md` - Testing procedures
- `CLOUD-FUNCTIONS-DEPLOYMENT-CHECKLIST.md` - Deployment checklist

## Support

### Firebase Documentation
- [Cloud Functions Guide](https://firebase.google.com/docs/functions)
- [Callable Functions](https://firebase.google.com/docs/functions/callable)
- [Admin SDK](https://firebase.google.com/docs/admin/setup)

### Project Documentation
See root directory for comprehensive guides.

---

**Version**: 1.0.0  
**Last Updated**: March 4, 2026  
**Status**: ✅ Production Ready

