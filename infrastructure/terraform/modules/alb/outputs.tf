output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  description = "For Route 53 alias records."
  value       = aws_lb.this.zone_id
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}
