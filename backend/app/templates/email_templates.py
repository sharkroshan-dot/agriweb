from typing import Dict, Any

class EmailTemplates:
    """Email templates for notifications."""

    @staticmethod
    def get_order_confirmation_template(order_data: Dict[str, Any]) -> str:
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: #2E7D32; color: white; padding: 20px; text-align: center; }}
                .content {{ padding: 20px; }}
                .order-details {{ background: #f5f5f5; padding: 15px; border-radius: 5px; }}
                .total {{ font-size: 20px; font-weight: bold; color: #2E7D32; }}
                .footer {{ text-align: center; padding: 20px; color: #666; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🌾 AgriConnect AI</h1>
                    <h2>Order Confirmation</h2>
                </div>
                <div class="content">
                    <p>Dear {order_data.get('customer_name')},</p>
                    <p>Thank you for your order! Your order has been confirmed.</p>
                    <div class="order-details">
                        <h3>Order #{order_data.get('order_number')}</h3>
                        <p><strong>Order Date:</strong> {order_data.get('order_date')}</p>
                        <p><strong>Items:</strong></p>
                        <ul>
                            {''.join([f"<li>{item['quantity']}x {item['product_name']} - ₹{item['total_price']}</li>" for item in order_data.get('items', [])])}
                        </ul>
                        <p><strong>Delivery Address:</strong> {order_data.get('address', '')}</p>
                        <p class="total">Total: ₹{order_data.get('total_amount', 0)}</p>
                    </div>
                    <p>Your order will be delivered soon. You can track it in the app.</p>
                    <p>Thank you for choosing AgriConnect!</p>
                </div>
                <div class="footer">
                    <p>&copy; 2024 AgriConnect AI. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """
