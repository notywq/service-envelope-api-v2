# Service Envelope API - Bruno Collection

Complete API collection for the Service Envelope System with all endpoints organized by category.

## 📥 Import Instructions

### Option 1: Import Folder (Recommended)
1. Open Bruno
2. Click **"Open Collection"** (Ctrl+O)
3. Navigate to: `bruno/Service Envelope API`
4. Select the folder and click **Open**

### Option 2: Drag & Drop
1. In Bruno, click **"Import Collection"**
2. Drag the `bruno/Service Envelope API` folder into the import dialog
3. Click **Import**

## 📂 Collection Structure

```
Service Envelope API/
├── bruno.json                 # Collection metadata
├── environments/
│   ├── Development.json      # Local development environment
│   └── Production.json       # Production environment
├── Services/                  # Service management endpoints
├── Requests/                  # Request tracking endpoints
├── Approvals/                 # Approval workflow endpoints
├── Auth/                      # Authentication endpoints
└── Admin/                     # Admin management endpoints
```

## 🔧 Configuration

### Set Active Environment
1. Click **"Environments"** in the top-right
2. Select **"Development"** (default for local testing)
3. Or select **"Production"** for production APIs

### Update Variables
Edit environment variables by:
1. Right-clicking the collection name
2. Select **"Settings"**
3. Go to **"Variables"** tab
4. Update values for:
   - `baseUrl` - API base URL
   - `requestId` - Test request ID
   - `serviceId` - Test service ID
   - `token` - Approval token for testing
   - `adminToken` - JWT token (obtained from login endpoints)

## 📋 Endpoints by Category

### Services (5 endpoints)
- ✅ List All Services
- ✅ Get Service IDs (Quick Reference)
- ✅ Get Single Service Details
- ✅ Submit Service Request (By ID)
- ✅ Submit Service Request (Unified)

### Requests (7 endpoints)
- ✅ List All Requests
- ✅ List Requests by Status
- ✅ List Requests by Type
- ✅ Get Request Details
- ✅ Get Request History
- ✅ Resume Request Processing
- ✅ Cancel Request

### Approvals (3 endpoints)
- ✅ Check Approval Token Status
- ✅ Approve Request via Token
- ✅ Deny Request via Token

### Authentication (4 endpoints)
- ✅ Login Admin
- ✅ Login Approver
- ✅ Login Requester
- ✅ Verify JWT Token

### Admin (6 endpoints)
- ✅ Create Service Definition
- ✅ Update Service Definition
- ✅ Get All Service Definitions
- ✅ Get Audit Logs
- ✅ Health Check
- ✅ API Info

## 🔐 Quick Test Flow

1. **Login** → Use any of the Auth endpoints to get a JWT token
2. **Copy token** → Replace `adminToken` variable with the token
3. **Explore Services** → List and view service definitions
4. **Submit Request** → Create a new service request
5. **Track Request** → Monitor request status and history
6. **Handle Approvals** → Approve or deny requests using tokens

## 📝 Mock Credentials

```
Admin:
  Email: admin@mapua.edu.ph
  Password: admin123

Approver:
  Email: approver@mapua.edu.ph
  Password: approver123

Requester:
  Email: requester@mapua.edu.ph
  Password: requester123
```

## 🚀 Getting Started

1. Import the collection using steps above
2. Select **Development** environment
3. Run **"Health Check"** endpoint to verify connection
4. Explore endpoints organized by category
5. Update request payloads as needed for your use case

## 💡 Tips

- Use **Variables** for frequently changing values
- Set **Pre-request Scripts** for automatic token refresh
- Use **Tests** tab to validate responses
- Create **Collections** within collections for nested organization
- Export collection to share with team members

## 📚 API Documentation

For detailed endpoint documentation, visit:
- Base URL: `http://localhost:8000`
- API Docs: `http://localhost:8000/api`
- Health: `http://localhost:8000/health`

---

**Last Updated:** May 19, 2026  
**API Version:** 1.0.0  
**Collection Version:** 1.0
