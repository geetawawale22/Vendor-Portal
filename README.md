# DispatchFlow

Smart Logistics & Dispatch Management System (Dispatcher/Vendor Logistics scope)

## Tech Stack
- Python (Flask)
- SQLite
- HTML + Bootstrap + CSS

## Setup
1. Create and activate virtual environment (already created in this workspace as `.venv`).
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Run the app:
   - `python app.py`
4. Open:
   - `http://127.0.0.1:5000/login`

## Default Login
- Username: `vendor.user`
- Password: `Vendor@2026`

## Implemented Modules
- Authentication (login/logout/session)
- Dashboard (total, in-transit, delivered, pending, recent dispatches)
- Create Dispatch (vehicle, material, billing, multi-ASN, uploads)
- Confirm Dispatch (shipment number generation and INTRANSIT status)
- Update Dispatch Status (location, remarks, delay reason, ETA, status)
- Upload Delivery Challan (delivery challan/signed invoice)
- Confirm Delivery (DELIVERED and closure)
- Reports (dispatch, delivery, ASN, vehicle usage) with filters

## Shipment Number Format
- `SHIP-YYYY-####`
- Example: `SHIP-2026-0001`

## Validation Covered
- Required fields
- Loaded weight > empty weight
- Quantity <= vehicle capacity
- Duplicate ASN in same dispatch blocked
- ASN quantity > 0 and cumulative ASN quantity <= dispatch quantity
- Driver mobile format validation (10-digit)
- File upload format validation (PDF/JPG/PNG)
