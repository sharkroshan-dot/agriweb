class SMSTemplates:
    """SMS templates for notifications."""

    @staticmethod
    def get_otp_template(otp: str) -> str:
        return f"Your AgriConnect OTP is: {otp}. Valid for 5 minutes."

    @staticmethod
    def get_order_confirmation_template(order_number: str) -> str:
        return f"Order #{order_number} confirmed! Track your order in the app."

    @staticmethod
    def get_order_delivered_template(order_number: str) -> str:
        return f"Order #{order_number} has been delivered! Enjoy your fresh produce."

    @staticmethod
    def get_delivery_assignment_template() -> str:
        return "New delivery assigned! Check your app for details."

    @staticmethod
    def get_order_delivered_rating_link_template(
        order_number: str,
        rating_link: str,
        has_delivery: bool = False
    ) -> str:
        subject = "Rate your products & delivery partner" if has_delivery else "Rate your products"
        return (
            f"AgriConnect: Order #{order_number} has been delivered! "
            f"Enjoy your fresh produce. {subject} here: {rating_link}"
        )
