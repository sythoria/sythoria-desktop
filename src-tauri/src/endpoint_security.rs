use crate::{search, AppError, NETWORK_CONFIG};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

const METADATA_HOSTS: &[&str] = &[
    "metadata",
    "metadata.google.internal",
    "metadata.azure.com",
    "metadata.aws.internal",
    "instance-data",
    "instance-data.ec2.internal",
];

const METADATA_IPV4: &[Ipv4Addr] = &[
    Ipv4Addr::new(169, 254, 169, 254),
    Ipv4Addr::new(100, 100, 100, 200),
    Ipv4Addr::new(168, 63, 129, 16),
];

const METADATA_IPV6: &[Ipv6Addr] = &[
    Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254),
    Ipv6Addr::new(0xfd20, 0x00ce, 0, 0, 0, 0, 0, 0x0254),
];

// These rules shipped as editable defaults before intrinsic destination checks
// existed. Ignore them as custom rules so an exact local grant can replace the
// legacy blanket entry without weakening the immutable baseline.
const LEGACY_INTRINSIC_RULES: &[&str] = &[
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.azure.com",
    "100.100.100.200",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "100.64.0.0/10",
    "fc00::/7",
    "fe80::/10",
];

#[derive(Debug)]
pub struct ValidatedEndpoint {
    pub url: url::Url,
    pub addresses: Vec<SocketAddr>,
}

fn normalized_host(host: &str) -> String {
    host.trim_end_matches('.').to_ascii_lowercase()
}

fn effective_port(url: &url::Url) -> Option<u16> {
    url.port_or_known_default().or_else(|| match url.scheme() {
        "ws" => Some(80),
        "wss" => Some(443),
        _ => None,
    })
}

fn endpoint_origin(url: &url::Url) -> Option<(String, String, u16)> {
    Some((
        url.scheme().to_ascii_lowercase(),
        normalized_host(url.host_str()?),
        effective_port(url)?,
    ))
}

fn is_metadata_host(host: &str) -> bool {
    let host = normalized_host(host);
    METADATA_HOSTS
        .iter()
        .any(|metadata| host == *metadata || host.ends_with(&format!(".{metadata}")))
}

fn ipv4_is_shared(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn ipv6_is_unique_local(address: Ipv6Addr) -> bool {
    address.octets()[0] & 0xfe == 0xfc
}

fn is_permanently_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => address.octets()[0] == 0 || METADATA_IPV4.contains(&address),
        IpAddr::V6(address) => {
            address.is_unspecified()
                || METADATA_IPV6.contains(&address)
                || address
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_permanently_forbidden_ip(IpAddr::V4(mapped)))
        }
    }
}

pub fn is_intrinsic_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => {
            address.is_loopback()
                || address.is_private()
                || address.is_link_local()
                || ipv4_is_shared(address)
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unicast_link_local()
                || ipv6_is_unique_local(address)
                || address
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_intrinsic_local_ip(IpAddr::V4(mapped)))
        }
    }
}

fn is_exact_local_grant(url: &url::Url, grants: &[String]) -> bool {
    let Some(origin) = endpoint_origin(url) else {
        return false;
    };
    grants.iter().any(|grant| {
        url::Url::parse(grant)
            .ok()
            .and_then(|parsed| endpoint_origin(&parsed))
            .is_some_and(|grant_origin| grant_origin == origin)
    })
}

fn is_legacy_intrinsic_rule(rule: &str) -> bool {
    LEGACY_INTRINSIC_RULES
        .iter()
        .any(|legacy| rule.eq_ignore_ascii_case(legacy))
}

fn custom_host_is_blocked(host: &str, rules: &[String]) -> bool {
    let host = normalized_host(host);
    rules.iter().any(|rule| {
        if is_legacy_intrinsic_rule(rule) || rule.contains('/') {
            return false;
        }
        let normalized_rule = normalized_host(rule);
        if rule.contains('*') {
            search::matches_wildcard(&host, &normalized_rule)
        } else {
            host == normalized_rule || host.ends_with(&format!(".{normalized_rule}"))
        }
    })
}

fn custom_ip_is_blocked(ip: IpAddr, rules: &[String]) -> bool {
    rules
        .iter()
        .filter(|rule| !is_legacy_intrinsic_rule(rule))
        .any(|rule| {
            if rule.contains('/') {
                search::ip_belongs_to_cidr(&ip, rule)
            } else if rule.contains('*') {
                search::matches_wildcard(&ip.to_string(), rule)
            } else {
                rule.parse::<IpAddr>().is_ok_and(|blocked| blocked == ip)
            }
        })
}

pub fn validate_local_grant(value: &str) -> Result<(), String> {
    let parsed =
        url::Url::parse(value).map_err(|_| "Local grants must be valid URLs".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "ws" | "wss")
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.host_str().is_none()
        || effective_port(&parsed).is_none()
        || !matches!(parsed.path(), "" | "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(
            "Local grants must be HTTP(S) or WS(S) origins without credentials, paths, queries, or fragments"
                .to_string(),
        );
    }
    let host = parsed.host_str().expect("host was validated");
    if is_metadata_host(host) {
        return Err("Cloud metadata endpoints cannot be granted".to_string());
    }
    if parsed
        .host()
        .and_then(|host| match host {
            url::Host::Ipv4(address) => Some(IpAddr::V4(address)),
            url::Host::Ipv6(address) => Some(IpAddr::V6(address)),
            url::Host::Domain(_) => None,
        })
        .is_some_and(is_permanently_forbidden_ip)
    {
        return Err("Unspecified and cloud metadata addresses cannot be granted".to_string());
    }
    Ok(())
}

pub async fn validate_outbound_url(
    raw_url: &str,
    allowed_schemes: &[&str],
) -> Result<ValidatedEndpoint, AppError> {
    let parsed = url::Url::parse(raw_url)
        .map_err(|error| AppError::UrlValidationError(format!("Invalid endpoint URL: {error}")))?;
    if !allowed_schemes.contains(&parsed.scheme())
        || parsed.username() != ""
        || parsed.password().is_some()
    {
        return Err(AppError::UrlValidationError(format!(
            "Endpoint must use one of these schemes without embedded credentials: {}",
            allowed_schemes.join(", ")
        )));
    }
    let host = parsed.host_str().ok_or_else(|| {
        AppError::UrlValidationError("Endpoint must include a hostname".to_string())
    })?;
    if is_metadata_host(host) {
        return Err(AppError::UrlValidationError(
            "Cloud metadata endpoints are always blocked".to_string(),
        ));
    }

    let config = {
        NETWORK_CONFIG
            .read()
            .map_err(|_| {
                AppError::UrlValidationError(
                    "Network policy is unavailable; outbound endpoint validation failed closed"
                        .to_string(),
                )
            })?
            .clone()
    };
    if custom_host_is_blocked(host, &config.blocked_hosts) {
        return Err(AppError::UrlValidationError(format!(
            "Endpoint host '{host}' is blocked by a custom network rule"
        )));
    }

    let port = effective_port(&parsed)
        .ok_or_else(|| AppError::UrlValidationError("Endpoint port is unknown".to_string()))?;
    let addresses: Vec<_> = match parsed.host() {
        Some(url::Host::Ipv4(address)) => vec![SocketAddr::new(IpAddr::V4(address), port)],
        Some(url::Host::Ipv6(address)) => vec![SocketAddr::new(IpAddr::V6(address), port)],
        Some(url::Host::Domain(domain)) => tokio::net::lookup_host((domain, port))
            .await
            .map_err(|error| {
                AppError::UrlValidationError(format!(
                    "Failed to resolve endpoint '{host}': {error}"
                ))
            })?
            .collect(),
        None => Vec::new(),
    };
    if addresses.is_empty() {
        return Err(AppError::UrlValidationError(format!(
            "Endpoint '{host}' did not resolve to an address"
        )));
    }

    let local_granted = is_exact_local_grant(&parsed, &config.allowed_local_endpoints);
    for address in &addresses {
        let ip = address.ip();
        if is_permanently_forbidden_ip(ip) {
            return Err(AppError::UrlValidationError(format!(
                "Endpoint '{host}' resolves to an unspecified or cloud metadata address"
            )));
        }
        if custom_ip_is_blocked(ip, &config.blocked_hosts) {
            return Err(AppError::UrlValidationError(format!(
                "Endpoint '{host}' resolves to an address blocked by a custom network rule"
            )));
        }
        if is_intrinsic_local_ip(ip) && !local_granted {
            return Err(AppError::UrlValidationError(format!(
                "Endpoint '{host}' resolves to a local, private, shared, or link-local address. Add the exact origin '{}' to Local endpoint grants in Settings > Privacy to allow it.",
                endpoint_origin(&parsed)
                    .map(|(scheme, host, port)| format!("{scheme}://{host}:{port}"))
                    .unwrap_or_else(|| raw_url.to_string())
            )));
        }
    }

    Ok(ValidatedEndpoint {
        url: parsed,
        addresses,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_intrinsic_local_ranges_independently_of_custom_rules() {
        for address in [
            "127.0.0.2",
            "10.2.3.4",
            "172.31.0.9",
            "192.168.1.10",
            "169.254.10.20",
            "100.64.1.2",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(is_intrinsic_local_ip(address.parse().unwrap()), "{address}");
        }
        assert!(!is_intrinsic_local_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_intrinsic_local_ip(
            "2606:4700:4700::1111".parse().unwrap()
        ));
    }

    #[test]
    fn grants_are_exact_origins_and_never_cover_metadata() {
        let grants = vec!["http://127.0.0.1:11434".to_string()];
        assert!(is_exact_local_grant(
            &url::Url::parse("http://127.0.0.1:11434/v1/chat").unwrap(),
            &grants,
        ));
        assert!(!is_exact_local_grant(
            &url::Url::parse("http://127.0.0.1:8080/v1/chat").unwrap(),
            &grants,
        ));
        assert!(validate_local_grant("http://169.254.169.254").is_err());
        assert!(validate_local_grant("http://168.63.129.16").is_err());
        assert!(validate_local_grant("http://[fd00:ec2::254]").is_err());
        assert!(validate_local_grant("http://metadata.google.internal").is_err());
    }

    #[test]
    fn legacy_defaults_do_not_become_removable_custom_policy() {
        assert!(!custom_host_is_blocked(
            "localhost",
            &["localhost".to_string()]
        ));
        assert!(!custom_ip_is_blocked(
            "10.0.0.1".parse().unwrap(),
            &["10.0.0.0/8".to_string()]
        ));
        assert!(custom_host_is_blocked(
            "api.example.test",
            &["*.example.test".to_string()]
        ));
    }
}
